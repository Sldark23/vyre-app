import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_DM_PARTICIPANTS, MAX_MESSAGE_LENGTH, MESSAGE_RATE_LIMIT } from '@vyre/shared';
import type { DMConversation, Message } from '@vyre/shared';
import { query } from '../db';
import { requireAuth } from './auth';
import { toPublicUser } from '../lib/serialize';
import { dmTopic, publishTopic, userTopic } from '../lib/events';
import { rateLimit } from '../lib/rateLimit';

const DM_MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id AS channel_id, m.content, m.edited_at,
         NULL AS reply_to, m.created_at,
         u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
         u.avatar_url AS u_avatar_url, u.banner_color AS u_banner_color,
         u.bio AS u_bio, u.status AS u_status, u.custom_status AS u_custom_status
  FROM dm_messages m
  JOIN users u ON u.id = m.author_id
`;

async function assertDmParticipant(conversationId: string, userId: string): Promise<void> {
  const r = await query(
    `SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  if (!r.rows.length) {
    const err = new Error('Você não faz parte desta conversa') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

async function getConversation(
  id: string,
  viewerId: string,
): Promise<DMConversation | null> {
  const c = await query(
    `SELECT c.* FROM dm_conversations c
     JOIN dm_participants p ON p.conversation_id = c.id AND p.user_id = $2
     WHERE c.id = $1`,
    [id, viewerId],
  );
  if (!c.rows[0]) return null;
  return buildConversation(c.rows[0]);
}

async function buildConversation(row: Record<string, unknown>): Promise<DMConversation> {
  const [participants, last] = await Promise.all([
    query(
      `SELECT u.* FROM dm_participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = $1 ORDER BY p.joined_at ASC`,
      [row.id as string],
    ),
    query(`${DM_MESSAGE_SELECT} WHERE m.conversation_id = $1 ORDER BY m.created_at DESC LIMIT 1`, [
      row.id as string,
    ]),
  ]);
  return {
    id: row.id as string,
    isGroup: row.is_group as boolean,
    name: (row.name as string | null) ?? null,
    participants: participants.rows.map(toPublicUser),
    lastMessage: last.rows[0] ? mapDmMessage(last.rows[0]) : null,
    createdAt: row.created_at as string,
  };
}

function mapDmMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    channelId: row.channel_id as string,
    content: row.content as string,
    editedAt: (row.edited_at as string | null) ?? null,
    replyTo: (row.reply_to as string | null) ?? null,
    createdAt: row.created_at as string,
    author: toPublicUser({
      id: row.u_id,
      username: row.u_username,
      display_name: row.u_display_name,
      avatar_url: row.u_avatar_url,
      banner_color: row.u_banner_color,
      bio: row.u_bio,
      status: row.u_status,
      custom_status: row.u_custom_status,
    }),
  };
}

export async function dmRoutes(app: FastifyInstance) {
  // Lista minhas conversas
  app.get('/dms', async (request, reply) => {
    const userId = requireAuth(request);
    const list = await query(
      `SELECT c.* FROM dm_conversations c
       JOIN dm_participants p ON p.conversation_id = c.id AND p.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId],
    );
    const conversations = await Promise.all(list.rows.map((r) => buildConversation(r)));
    conversations.sort((a, b) => {
      const ta = a.lastMessage?.createdAt ?? a.createdAt;
      const tb = b.lastMessage?.createdAt ?? b.createdAt;
      return tb.localeCompare(ta);
    });
    return reply.send({ conversations });
  });

  // Abrir/criar conversa: 1 usuário = DM 1:1 (reusa se já existir); vários = grupo (máx 10)
  app.post('/dms', async (request, reply) => {
    const userId = requireAuth(request);
    if (!rateLimit(`dms:${userId}`, 20)) {
      return reply.code(429).send({ error: 'Muitas tentativas, tente em instantes' });
    }
    const parsed = z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(MAX_DM_PARTICIPANTS - 1),
        name: z.string().min(1).max(50).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Conversa inválida' });

    const targets = [...new Set(parsed.data.userIds)].filter((id) => id !== userId);
    if (!targets.length) return reply.code(400).send({ error: 'Escolha ao menos uma pessoa' });

    // Cada destinatário precisa ser amigo OU compartilhar um cluster comigo
    for (const t of targets) {
      const check = await query(
        `SELECT
           EXISTS (SELECT 1 FROM friendships
                   WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1))
           OR EXISTS (SELECT 1 FROM cluster_members m1
                      JOIN cluster_members m2 ON m2.cluster_id = m1.cluster_id AND m2.user_id = $2
                      WHERE m1.user_id = $1) AS ok,
         EXISTS (SELECT 1 FROM users WHERE id = $2) AS exists`,
        [userId, t],
      );
      if (!check.rows[0]?.exists) {
        return reply.code(404).send({ error: 'Usuário não encontrado' });
      }
      if (!check.rows[0]?.ok) {
        return reply.code(403).send({ error: 'Você só pode conversar com amigos ou pessoas dos seus clusters' });
      }
    }

    // DM 1:1: reusa conversa existente
    if (targets.length === 1) {
      const existing = await query(
        `SELECT c.id FROM dm_conversations c
         JOIN dm_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
         JOIN dm_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
         WHERE c.is_group = false
           AND (SELECT count(*) FROM dm_participants p WHERE p.conversation_id = c.id) = 2
         LIMIT 1`,
        [userId, targets[0]],
      );
      if (existing.rows[0]) {
        const conv = await getConversation(existing.rows[0].id, userId);
        return reply.send({ conversation: conv, existing: true });
      }
    }

    const isGroup = targets.length > 1;
    const created = await query(
      `INSERT INTO dm_conversations (is_group, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [isGroup, isGroup ? parsed.data.name ?? null : null, userId],
    );
    const convRow = created.rows[0];
    for (const t of [userId, ...targets]) {
      await query(`INSERT INTO dm_participants (conversation_id, user_id) VALUES ($1, $2)`, [
        convRow.id,
        t,
      ]);
    }

    const conversation = await buildConversation(convRow);
    // Avisa os outros participantes (pra lista de DMs deles aparecer na hora)
    for (const t of targets) {
      await publishTopic(userTopic(t), { type: 'dm:created', conversation });
    }
    return reply.code(201).send({ conversation, existing: false });
  });

  // Histórico de mensagens da conversa
  app.get('/dms/:id/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const conv = await getConversation(id, userId);
    if (!conv) return reply.code(404).send({ error: 'Conversa não encontrada' });

    const q = z
      .object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'Parâmetros inválidos' });

    const result = await query(
      `${DM_MESSAGE_SELECT} WHERE m.conversation_id = $1
       AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [id, q.data.before ?? null, q.data.limit],
    );
    return reply.send({ messages: result.rows.map(mapDmMessage).reverse() });
  });

  // Enviar mensagem na conversa
  app.post('/dms/:id/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ content: z.string().min(1).max(MAX_MESSAGE_LENGTH) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });

    await assertDmParticipant(id, userId);
    if (!rateLimit(`dm:${userId}`, MESSAGE_RATE_LIMIT)) {
      return reply.code(429).send({ error: 'Calma! Você está enviando mensagens rápido demais' });
    }

    const content = parsed.data.content.trim();
    if (!content) return reply.code(400).send({ error: 'Mensagem vazia' });

    const inserted = await query(
      `INSERT INTO dm_messages (conversation_id, author_id, content) VALUES ($1, $2, $3)
       RETURNING id`,
      [id, userId, content],
    );
    const full = await query(DM_MESSAGE_SELECT + ` WHERE m.id = $1`, [inserted.rows[0].id]);
    const message = mapDmMessage(full.rows[0]);
    await publishTopic(dmTopic(id), { type: 'dm:message:created', conversationId: id, message });
    return reply.code(201).send({ message });
  });

  // Editar mensagem de DM (autor)
  app.patch('/dm-messages/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ content: z.string().min(1).max(MAX_MESSAGE_LENGTH) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });

    const existing = await query(`SELECT * FROM dm_messages WHERE id = $1`, [id]);
    const msg = existing.rows[0];
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' });
    if (msg.author_id !== userId) return reply.code(403).send({ error: 'Só o autor pode editar' });

    await query(`UPDATE dm_messages SET content = $1, edited_at = now() WHERE id = $2`, [
      parsed.data.content.trim(),
      id,
    ]);
    const full = await query(DM_MESSAGE_SELECT + ` WHERE m.id = $1`, [id]);
    const message = mapDmMessage(full.rows[0]);
    await publishTopic(dmTopic(msg.conversation_id), {
      type: 'dm:message:edited',
      conversationId: msg.conversation_id,
      message,
    });
    return reply.send({ message });
  });

  // Apagar mensagem de DM (autor)
  app.delete('/dm-messages/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const existing = await query(`SELECT * FROM dm_messages WHERE id = $1`, [id]);
    const msg = existing.rows[0];
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' });
    if (msg.author_id !== userId) return reply.code(403).send({ error: 'Só o autor pode apagar' });
    await query(`DELETE FROM dm_messages WHERE id = $1`, [id]);
    await publishTopic(dmTopic(msg.conversation_id), {
      type: 'dm:message:deleted',
      conversationId: msg.conversation_id,
      id,
    });
    return reply.send({ ok: true });
  });
}
