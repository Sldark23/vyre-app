import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_MESSAGE_LENGTH, MESSAGE_RATE_LIMIT } from '@vyre/shared';
import { query } from '../db';
import { env } from '../env';
import { requireAuth } from './auth';
import { MESSAGE_SELECT, rowToMessage, toChannel } from '../lib/serialize';
import { publishChannel } from '../lib/events';
import { rateLimit } from '../lib/rateLimit';

interface ChannelInfo {
  id: string;
  clusterId: string;
  type: string;
  slowmodeSeconds: number;
  locked: boolean;
}

async function getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
  const result = await query(`SELECT * FROM channels WHERE id = $1`, [channelId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    clusterId: row.cluster_id,
    type: row.type,
    slowmodeSeconds: row.slowmode_seconds,
    locked: row.locked,
  };
}

async function assertMember(clusterId: string, userId: string) {
  const result = await query(
    `SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`,
    [clusterId, userId],
  );
  if (!result.rows.length) {
    const err = new Error('Você não é membro deste cluster') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

/** Papel no cluster (null = não é membro). */
async function roleIn(
  clusterId: string,
  userId: string,
): Promise<'owner' | 'moderator' | 'member' | null> {
  const r = await query(`SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`, [
    clusterId,
    userId,
  ]);
  return r.rows[0]?.role ?? null;
}

async function assertMod(clusterId: string, userId: string): Promise<'owner' | 'moderator'> {
  const role = await roleIn(clusterId, userId);
  if (role !== 'owner' && role !== 'moderator') {
    const err = new Error('Só donos e moderadores podem fazer isso') as Error & {
      statusCode: number;
    };
    err.statusCode = 403;
    throw err;
  }
  return role;
}

const attachmentSchema = z
  .array(
    z.object({
      url: z
        .string()
        .max(500)
        .refine((u) => u.startsWith(`${env.publicUrl}/uploads/`), {
          message: 'URL de anexo inválida',
        }),
      name: z.string().min(1).max(200),
    }),
  )
  .max(4)
  .optional();

export async function channelRoutes(app: FastifyInstance) {
  // Info do canal + cluster
  app.get('/channels/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMember(channel.clusterId, userId);
    const result = await query(`SELECT * FROM channels WHERE id = $1`, [id]);
    return reply.send({ channel: toChannel(result.rows[0]) });
  });

  // Histórico de mensagens (paginação por cursor de data)
  app.get('/channels/:id/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMember(channel.clusterId, userId);

    const q = z
      .object({
        before: z.string().datetime().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'Parâmetros inválidos' });

    const result = await query(
      `${MESSAGE_SELECT} WHERE m.channel_id = $1
       AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [id, q.data.before ?? null, q.data.limit],
    );
    return reply.send({ messages: result.rows.map(rowToMessage).reverse() });
  });

  // Enviar mensagem
  app.post('/channels/:id/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        content: z.string().max(MAX_MESSAGE_LENGTH).optional(),
        replyTo: z.string().uuid().optional(),
        attachments: attachmentSchema,
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });

    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMember(channel.clusterId, userId);

    if (channel.locked) return reply.code(403).send({ error: 'Canal travado pelos moderadores' });
    if (channel.type === 'voice') {
      return reply.code(403).send({ error: 'Canais de voz não aceitam mensagens' });
    }
    if (channel.type === 'announcement') {
      const role = await roleIn(channel.clusterId, userId);
      if (role !== 'owner' && role !== 'moderator') {
        return reply
          .code(403)
          .send({ error: 'Só donos e moderadores publicam em canais de anúncios' });
      }
    }
    if (!rateLimit(`msg:${userId}`, MESSAGE_RATE_LIMIT)) {
      return reply.code(429).send({ error: 'Calma! Você está enviando mensagens rápido demais' });
    }
    if (channel.slowmodeSeconds > 0) {
      const last = await query(
        `SELECT created_at FROM messages WHERE channel_id = $1 AND author_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [id, userId],
      );
      if (last.rows[0]) {
        const elapsed = Date.now() - new Date(last.rows[0].created_at).getTime();
        if (elapsed < channel.slowmodeSeconds * 1000) {
          return reply.code(429).send({
            error: `Slowmode ativo: espere ${Math.ceil((channel.slowmodeSeconds * 1000 - elapsed) / 1000)}s`,
          });
        }
      }
    }

    const content = (parsed.data.content ?? '').trim();
    const attachments = parsed.data.attachments ?? [];
    if (!content && attachments.length === 0) {
      return reply.code(400).send({ error: 'Mensagem vazia' });
    }

    const inserted = await query(
      `INSERT INTO messages (channel_id, author_id, content, reply_to, attachments)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [id, userId, content, parsed.data.replyTo ?? null, JSON.stringify(attachments)],
    );
    const full = await query(MESSAGE_SELECT + ` WHERE m.id = $1`, [inserted.rows[0].id]);
    const message = rowToMessage(full.rows[0]);
    await publishChannel(id, { type: 'message:created', message });
    return reply.code(201).send({ message });
  });

  // Editar mensagem (autor)
  app.patch('/messages/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ content: z.string().min(1).max(MAX_MESSAGE_LENGTH) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Mensagem inválida' });

    const existing = await query(`SELECT * FROM messages WHERE id = $1`, [id]);
    const msg = existing.rows[0];
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' });
    if (msg.author_id !== userId) return reply.code(403).send({ error: 'Só o autor pode editar' });

    await query(`UPDATE messages SET content = $1, edited_at = now() WHERE id = $2`, [
      parsed.data.content.trim(),
      id,
    ]);
    const full = await query(MESSAGE_SELECT + ` WHERE m.id = $1`, [id]);
    const message = rowToMessage(full.rows[0]);
    await publishChannel(msg.channel_id, { type: 'message:edited', message });
    return reply.send({ message });
  });

  // Apagar mensagem (autor ou moderador do cluster)
  app.delete('/messages/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const existing = await query(`SELECT * FROM messages WHERE id = $1`, [id]);
    const msg = existing.rows[0];
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada' });
    if (msg.author_id !== userId) {
      const channel = await getChannelInfo(msg.channel_id);
      const modRole = channel ? await roleIn(channel.clusterId, userId) : null;
      if (modRole !== 'owner' && modRole !== 'moderator') {
        return reply.code(403).send({ error: 'Só o autor ou moderadores podem apagar' });
      }
    }
    await query(`DELETE FROM messages WHERE id = $1`, [id]);
    await publishChannel(msg.channel_id, { type: 'message:deleted', id, channelId: msg.channel_id });
    return reply.send({ ok: true });
  });

  // Busca com filtros: de:usuario antes:YYYY-MM-DD depois:YYYY-MM-DD + termo livre
  app.get('/channels/:id/search', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMember(channel.clusterId, userId);

    const q = z.object({ q: z.string().min(1).max(200) }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'Informe o termo de busca' });

    let term: string | null = null;
    let author: string | null = null;
    let before: string | null = null;
    let after: string | null = null;
    const words: string[] = [];
    for (const token of q.data.q.split(/\s+/)) {
      if (token.startsWith('de:')) author = token.slice(3).toLowerCase() || null;
      else if (token.startsWith('antes:')) before = token.slice(6) || null;
      else if (token.startsWith('depois:')) after = token.slice(7) || null;
      else if (token) words.push(token);
    }
    term = words.length ? words.join(' ') : null;
    if (!term && !author && !before && !after) {
      return reply.code(400).send({ error: 'Busca vazia' });
    }

    const result = await query(
      `${MESSAGE_SELECT}
       WHERE m.channel_id = $1
         AND ($2::text IS NULL OR m.author_id = (SELECT id FROM users WHERE username = $2))
         AND ($3::timestamptz IS NULL OR m.created_at < $3)
         AND ($4::timestamptz IS NULL OR m.created_at > $4)
         AND ($5::text IS NULL
              OR m.content ILIKE '%' || $5 || '%'
              OR to_tsvector('portuguese', m.content) @@ websearch_to_tsquery('portuguese', $5))
       ORDER BY m.created_at DESC LIMIT 50`,
      [id, author, before, after, term],
    );
    return reply.send({ messages: result.rows.map(rowToMessage) });
  });

  // ---------- Gestão de canais (mod+) ----------

  // Criar canal no cluster
  app.post('/clusters/:id/channels', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).max(100),
        type: z.enum(['text', 'voice', 'announcement', 'forum']).default('text'),
        topic: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const cluster = await query(`SELECT id FROM clusters WHERE id = $1`, [id]);
    if (!cluster.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });
    await assertMod(id, userId);

    const maxPos = await query(`SELECT COALESCE(MAX(position), -1) AS m FROM channels WHERE cluster_id = $1`, [id]);
    const created = await query(
      `INSERT INTO channels (cluster_id, name, type, topic, position)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, parsed.data.name.trim(), parsed.data.type, parsed.data.topic ?? '', maxPos.rows[0].m + 1],
    );
    return reply.code(201).send({ channel: toChannel(created.rows[0]) });
  });

  // Editar canal (nome, tópico, tipo, slowmode, trava, mover)
  app.patch('/channels/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        topic: z.string().max(500).optional(),
        type: z.enum(['text', 'voice', 'announcement', 'forum']).optional(),
        slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
        locked: z.boolean().optional(),
        move: z.enum(['up', 'down']).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMod(channel.clusterId, userId);
    const p = parsed.data;

    if (p.move) {
      const all = await query(
        `SELECT id FROM channels WHERE cluster_id = $1 ORDER BY position`,
        [channel.clusterId],
      );
      const idx = all.rows.findIndex((r) => r.id === id);
      const swapWith = p.move === 'up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swapWith >= 0 && swapWith < all.rows.length) {
        const a = all.rows[idx].id;
        const b = all.rows[swapWith].id;
        await query(
          `UPDATE channels SET position = CASE id WHEN $1::uuid THEN $3::int WHEN $2::uuid THEN $4::int END
           WHERE id IN ($1::uuid, $2::uuid)`,
          [a, b, swapWith, idx],
        );
      }
    }

    const updated = await query(
      `UPDATE channels SET
         name = COALESCE($2, name),
         topic = COALESCE($3, topic),
         type = COALESCE($4, type),
         slowmode_seconds = COALESCE($5, slowmode_seconds),
         locked = COALESCE($6, locked)
       WHERE id = $1 RETURNING *`,
      [
        id,
        p.name?.trim() ?? null,
        p.topic ?? null,
        p.type ?? null,
        p.slowmodeSeconds ?? null,
        p.locked ?? null,
      ],
    );
    const channels = await query(`SELECT * FROM channels WHERE cluster_id = $1 ORDER BY position`, [
      channel.clusterId,
    ]);
    return reply.send({ channel: toChannel(updated.rows[0]), channels: channels.rows.map(toChannel) });
  });

  // Apagar canal (mod+, mas nunca o último)
  app.delete('/channels/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const channel = await getChannelInfo(id);
    if (!channel) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMod(channel.clusterId, userId);

    const count = await query(`SELECT count(*) AS c FROM channels WHERE cluster_id = $1`, [
      channel.clusterId,
    ]);
    if (Number(count.rows[0].c) <= 1) {
      return reply.code(400).send({ error: 'O cluster precisa de pelo menos um canal' });
    }
    await query(`DELETE FROM channels WHERE id = $1`, [id]);
    return reply.send({ ok: true });
  });
}
