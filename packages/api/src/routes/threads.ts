import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { env } from '../env';
import { requireAuth } from './auth';

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

async function assertMod(clusterId: string, userId: string) {
  const r = await query(`SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`, [
    clusterId,
    userId,
  ]);
  const role = r.rows[0]?.role;
  if (role !== 'owner' && role !== 'moderator') {
    const err = new Error('Só donos e moderadores podem fazer isso') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

const createThreadSchema = z.object({
  name: z.string().max(100).optional(),
});

const addReactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});

const pinMessageSchema = z.object({
  messageId: z.string().uuid(),
});

export async function threadRoutes(app: FastifyInstance) {

  // ============ THREADS ============

  // Listar threads de um canal
  app.get('/channels/:channelId/threads', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const { limit = '50', before } = request.query as { limit?: string; before?: string };

    // Verificar se é membro do cluster
    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    let sql = `
      SELECT mt.*, 
        u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*) FROM messages WHERE thread_id = mt.id) as messages_count
      FROM message_threads mt
      JOIN messages m ON mt.parent_message_id = m.id
      JOIN users u ON m.author_id = u.id
      WHERE mt.channel_id = $1
    `;
    const params: any[] = [channelId];

    if (before) {
      sql += ` AND mt.last_message_at < $2`;
      params.push(before);
    }

    sql += ` ORDER BY mt.last_message_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await query(sql, params);
    return reply.send({ threads: result.rows });
  });

  // Criar thread a partir de uma mensagem
  app.post('/messages/:messageId/thread', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId } = request.params as { messageId: string };
    const parsed = createThreadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { name } = parsed.data;

    // Verificar se mensagem existe e pegar canal
    const msg = await query(
      'SELECT channel_id, author_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada' });

    // Verificar acesso ao canal
    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [msg.rows[0].channel_id]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    // Verificar se thread já existe
    const existing = await query(
      'SELECT * FROM message_threads WHERE parent_message_id = $1',
      [messageId]
    );
    if (existing.rows[0]) {
      return reply.code(409).send({ error: 'Thread já existe para esta mensagem', thread: existing.rows[0] });
    }

    const result = await query(
      `INSERT INTO message_threads (channel_id, parent_message_id, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [msg.rows[0].channel_id, messageId, name || null]
    );

    // Mover a mensagem original para a thread
    await query(
      'UPDATE messages SET thread_id = $1 WHERE id = $2',
      [result.rows[0].id, messageId]
    );

    return reply.code(201).send({ thread: result.rows[0] });
  });

  // Obter mensagens de uma thread
  app.get('/threads/:threadId/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { threadId } = request.params as { threadId: string };
    const { limit = '50', before } = request.query as { limit?: string; before?: string };

    const thread = await query(
      `SELECT mt.*, c.cluster_id 
       FROM message_threads mt
       JOIN channels c ON mt.channel_id = c.id
       WHERE mt.id = $1`,
      [threadId]
    );
    if (!thread.rows[0]) return reply.code(404).send({ error: 'Thread não encontrada' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [thread.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    let sql = `
      SELECT m.*, u.username, u.display_name, u.avatar_url, u.plus
      FROM messages m
      JOIN users u ON m.author_id = u.id
      WHERE m.thread_id = $1
    `;
    const params: any[] = [threadId];

    if (before) {
      sql += ` AND m.created_at < $2`;
      params.push(before);
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await query(sql, params);
    return reply.send({ messages: result.rows.reverse() });
  });

  // Enviar mensagem em uma thread
  app.post('/threads/:threadId/messages', async (request, reply) => {
    const userId = requireAuth(request);
    const { threadId } = request.params as { threadId: string };
    const { content, replyTo, attachments } = request.body as {
      content: string;
      replyTo?: string;
      attachments?: { url: string; name: string }[];
    };

    if (!content?.trim() && (!attachments || attachments.length === 0)) {
      return reply.code(400).send({ error: 'Mensagem vazia' });
    }

    const thread = await query(
      `SELECT mt.*, c.cluster_id 
       FROM message_threads mt
       JOIN channels c ON mt.channel_id = c.id
       WHERE mt.id = $1`,
      [threadId]
    );
    if (!thread.rows[0]) return reply.code(404).send({ error: 'Thread não encontrada' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [thread.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    // Verificar slowmode
    const channel = await query('SELECT slowmode_seconds FROM channels WHERE id = $1', [thread.rows[0].channel_id]);
    if (channel.rows[0]?.slowmode_seconds > 0) {
      const lastMsg = await query(
        'SELECT created_at FROM messages WHERE author_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT 1',
        [userId, thread.rows[0].channel_id]
      );
      if (lastMsg.rows[0]) {
        const diff = Date.now() - new Date(lastMsg.rows[0].created_at).getTime();
        if (diff < channel.rows[0].slowmode_seconds * 1000) {
          return reply.code(429).send({ error: 'Modo lento ativo' });
        }
      }
    }

    const result = await query(
      `INSERT INTO messages (channel_id, author_id, content, reply_to, thread_id, attachments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        thread.rows[0].channel_id,
        userId,
        content.trim(),
        replyTo || null,
        threadId,
        JSON.stringify(attachments || [])
      ]
    );

    // Atualizar thread
    await query(
      `UPDATE message_threads 
       SET message_count = message_count + 1, last_message_at = now()
       WHERE id = $1`,
      [threadId]
    );

    const msg = await query(
      `SELECT m.*, u.username, u.display_name, u.avatar_url, u.plus
       FROM messages m
       JOIN users u ON m.author_id = u.id
       WHERE m.id = $1`,
      [result.rows[0].id]
    );

    return reply.code(201).send({ message: msg.rows[0] });
  });

  // ============ REACTIONS ============

  // Adicionar reação
  app.post('/messages/:messageId/reactions', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId } = request.params as { messageId: string };
    const parsed = addReactionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Emoji inválido' });

    const { emoji } = parsed.data;

    // Verificar se mensagem existe e acesso
    const msg = await query(
      `SELECT m.*, c.cluster_id 
       FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE m.id = $1`,
      [messageId]
    );
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [msg.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    try {
      await query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, userId, emoji]
      );
    } catch (err) {
      // Ignore duplicate
    }

    return reply.code(201).send({ ok: true });
  });

  // Remover reação
  app.delete('/messages/:messageId/reactions/:emoji', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId, emoji } = request.params as { messageId: string; emoji: string };

    await query(
      `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, userId, emoji]
    );

    return reply.send({ ok: true });
  });

  // Listar reações de uma mensagem
  app.get('/messages/:messageId/reactions', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId } = request.params as { messageId: string };

    const msg = await query(
      `SELECT m.*, c.cluster_id 
       FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE m.id = $1`,
      [messageId]
    );
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [msg.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    const result = await query(
      `SELECT emoji, COUNT(*) as count, 
        bool_or(user_id = $2) as me_reacted
       FROM message_reactions
       WHERE message_id = $1
       GROUP BY emoji`,
      [messageId, userId]
    );

    return reply.send({ reactions: result.rows });
  });

  // ============ EDIT HISTORY ============

  // Obter histórico de edições (apenas mods/owner)
  app.get('/messages/:messageId/history', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId } = request.params as { messageId: string };

    const msg = await query(
      `SELECT m.*, c.cluster_id 
       FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE m.id = $1`,
      [messageId]
    );
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada' });

    const member = await query(
      `SELECT role FROM cluster_members 
       WHERE cluster_id = $1 AND user_id = $2`,
      [msg.rows[0].cluster_id, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Apenas moderadores podem ver histórico' });
    }

    const result = await query(
      `SELECT me.*, u.username, u.display_name
       FROM message_edits me
       JOIN users u ON me.edited_by = u.id
       WHERE me.message_id = $1
       ORDER BY me.edited_at DESC`,
      [messageId]
    );

    return reply.send({ history: result.rows });
  });

  // ============ PINS ============

  // Listar pins de um canal
  app.get('/channels/:channelId/pins', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    const result = await query(
      `SELECT pm.*, m.content, m.author_id, m.created_at,
        u.username, u.display_name, u.avatar_url
       FROM pinned_messages pm
       JOIN messages m ON pm.message_id = m.id
       JOIN users u ON m.author_id = u.id
       WHERE pm.channel_id = $1
       ORDER BY pm.pinned_at DESC`,
      [channelId]
    );

    return reply.send({ pins: result.rows });
  });

  // Fixar mensagem
  app.post('/channels/:channelId/pins', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const parsed = pinMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'ID da mensagem inválido' });

    const { messageId } = parsed.data;

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    // Verificar permissão (owner, moderator, ou autor da mensagem)
    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    const isMod = ['owner', 'moderator'].includes(member.rows[0].role);

    // Verificar se mensagem pertence ao canal
    const msg = await query('SELECT author_id FROM messages WHERE id = $1 AND channel_id = $2', [messageId, channelId]);
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada neste canal' });

    const isAuthor = msg.rows[0].author_id === userId;
    if (!isMod && !isAuthor) {
      return reply.code(403).send({ error: 'Apenas moderadores ou autor podem fixar' });
    }

    try {
      await query(
        `INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, message_id) DO NOTHING`,
        [channelId, messageId, userId]
      );
    } catch (err) {
      // Ignore
    }

    return reply.code(201).send({ ok: true });
  });

  // Desfixar mensagem
  app.delete('/channels/:channelId/pins/:messageId', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId, messageId } = request.params as { channelId: string; messageId: string };

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    const isMod = ['owner', 'moderator'].includes(member.rows[0].role);
    const pin = await query('SELECT pinned_by FROM pinned_messages WHERE channel_id = $1 AND message_id = $2', [channelId, messageId]);
    const isPinner = pin.rows[0]?.pinned_by === userId;

    if (!isMod && !isPinner) {
      return reply.code(403).send({ error: 'Apenas moderadores ou quem fixou podem desfixar' });
    }

    await query('DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2', [channelId, messageId]);
    return reply.send({ ok: true });
  });
}

export { createThreadSchema, addReactionSchema, pinMessageSchema };