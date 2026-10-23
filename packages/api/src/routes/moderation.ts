import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from './auth';

const createAutoModRuleSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['spam', 'links', 'words', 'caps', 'mentions', 'attachments']),
  config: z.record(z.any()).default({}),
  action: z.enum(['delete', 'timeout', 'flag']),
  actionConfig: z.record(z.any()).default({}),
});

const updateAutoModRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.any()).optional(),
  action: z.enum(['delete', 'timeout', 'flag']).optional(),
  actionConfig: z.record(z.any()).optional(),
  enabled: z.boolean().optional(),
});

const timeoutSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  duration: z.number().int().min(60).max(2419200), // 1 min a 28 dias
});

const banSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  expiresAt: z.string().datetime().optional().nullable(), // null = permanente
});

const reportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'hate', 'violence', 'illegal', 'nsfw', 'other']),
  details: z.string().max(1000).optional(),
});

export async function moderationRoutes(app: FastifyInstance) {
  // ============ AUTO-MOD ============

  // Listar regras de auto-mod
  app.get('/clusters/:clusterId/auto-mod', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const result = await query(
      `SELECT * FROM auto_mod_rules WHERE cluster_id = $1 ORDER BY created_at DESC`,
      [clusterId]
    );

    return reply.send({ rules: result.rows });
  });

  // Criar regra
  app.post('/clusters/:clusterId/auto-mod', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const parsed = createAutoModRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const { name, type, config, action, actionConfig } = parsed.data;

    const result = await query(
      `INSERT INTO auto_mod_rules (cluster_id, name, type, config, action, action_config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [clusterId, name, type, JSON.stringify(config), action, JSON.stringify(actionConfig)]
    );

    return reply.code(201).send({ rule: result.rows[0] });
  });

  // Atualizar regra
  app.patch('/clusters/:clusterId/auto-mod/:ruleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, ruleId } = request.params as { clusterId: string; ruleId: string };
    const parsed = updateAutoModRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const { name, config, action, actionConfig, enabled } = parsed.data;
    const updates: string[] = [];
    const params: any[] = [ruleId];
    let idx = 2;

    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
    if (config !== undefined) { updates.push(`config = $${idx++}`); params.push(JSON.stringify(config)); }
    if (action !== undefined) { updates.push(`action = $${idx++}`); params.push(action); }
    if (actionConfig !== undefined) { updates.push(`action_config = $${idx++}`); params.push(JSON.stringify(actionConfig)); }
    if (enabled !== undefined) { updates.push(`enabled = $${idx++}`); params.push(enabled); }

    updates.push(`updated_at = now()`);

    if (updates.length === 1) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });

    const result = await query(
      `UPDATE auto_mod_rules SET ${updates.join(', ')} WHERE id = $1 AND cluster_id = $2 RETURNING *`,
      [ruleId, clusterId, ...params]
    );

    if (!result.rows[0]) return reply.code(404).send({ error: 'Regra não encontrada' });

    return reply.send({ rule: result.rows[0] });
  });

  // Deletar regra
  app.delete('/clusters/:clusterId/auto-mod/:ruleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, ruleId } = request.params as { clusterId: string; ruleId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    await query('DELETE FROM auto_mod_rules WHERE id = $1 AND cluster_id = $2', [ruleId, clusterId]);
    return reply.send({ ok: true });
  });

  // ============ TIMEOUTS ============

  // Listar timeouts ativos
  app.get('/clusters/:clusterId/timeouts', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const result = await query(
      `SELECT mt.*, u.username, u.display_name, u.avatar_url,
        mod.username as moderator_username
       FROM member_timeouts mt
       JOIN users u ON mt.user_id = u.id
       JOIN users mod ON mt.moderator_id = mod.id
       WHERE mt.cluster_id = $1 AND mt.expires_at > now()
       ORDER BY mt.expires_at ASC`,
      [clusterId]
    );

    return reply.send({ timeouts: result.rows });
  });

  // Aplicar timeout
  app.post('/clusters/:clusterId/timeouts', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const parsed = timeoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { userId: targetUserId, reason, duration } = parsed.data;

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    // Não pode timeout owner
    const targetRole = await query('SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    if (targetRole.rows[0]?.role === 'owner') {
      return reply.code(400).send({ error: 'Não pode dar timeout no dono' });
    }

    // Não pode timeout mod se não for owner
    const actorRole = await query('SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, userId]);
    if (targetRole.rows[0]?.role === 'moderator' && actorRole.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode dar timeout em moderadores' });
    }

    const expiresAt = new Date(Date.now() + duration * 1000).toISOString();

    // Remover timeout anterior se existir
    await query('DELETE FROM member_timeouts WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);

    await query(
      `INSERT INTO member_timeouts (cluster_id, user_id, moderator_id, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [clusterId, targetUserId, userId, reason || null, expiresAt]
    );

    return reply.code(201).send({ ok: true });
  });

  // Remover timeout
  app.delete('/clusters/:clusterId/timeouts/:userId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, userId: targetUserId } = request.params as { clusterId: string; userId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    await query('DELETE FROM member_timeouts WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    return reply.send({ ok: true });
  });

  // ============ BANS ============

  // Listar bans
  app.get('/clusters/:clusterId/bans', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const result = await query(
      `SELECT mb.*, u.username, u.display_name, u.avatar_url,
        mod.username as moderator_username
       FROM member_bans mb
       JOIN users u ON mb.user_id = u.id
       JOIN users mod ON mb.moderator_id = mod.id
       WHERE mb.cluster_id = $1 AND (mb.expires_at IS NULL OR mb.expires_at > now())
       ORDER BY mb.created_at DESC`,
      [clusterId]
    );

    return reply.send({ bans: result.rows });
  });

  // Banir usuário
  app.post('/clusters/:clusterId/bans', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const parsed = banSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { userId: targetUserId, reason, expiresAt } = parsed.data;

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    // Não pode banir owner
    const targetRole = await query('SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    if (targetRole.rows[0]?.role === 'owner') {
      return reply.code(400).send({ error: 'Não pode banir o dono' });
    }

    // Não pode banir mod se não for owner
    const actorRole = await query('SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, userId]);
    if (targetRole.rows[0]?.role === 'moderator' && actorRole.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode banir moderadores' });
    }

    await query(
      `INSERT INTO member_bans (cluster_id, user_id, moderator_id, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cluster_id, user_id) DO UPDATE SET
         moderator_id = $3, reason = $4, expires_at = $5, created_at = now()`,
      [clusterId, targetUserId, userId, reason || null, expiresAt || null]
    );

    // Remover do cluster se ban permanente
    if (!expiresAt) {
      await query('DELETE FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    }

    return reply.code(201).send({ ok: true });
  });

  // Remover ban (unban)
  app.delete('/clusters/:clusterId/bans/:userId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, userId: targetUserId } = request.params as { clusterId: string; userId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    await query('DELETE FROM member_bans WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    return reply.send({ ok: true });
  });

  // ============ REPORTS ============

  // Reportar mensagem
  app.post('/messages/:messageId/report', async (request, reply) => {
    const userId = requireAuth(request);
    const { messageId } = request.params as { messageId: string };
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { reason, details } = parsed.data;

    // Verificar se mensagem existe
    const msg = await query(
      `SELECT m.*, c.cluster_id 
       FROM messages m
       JOIN channels c ON m.channel_id = c.id
       WHERE m.id = $1`,
      [messageId]
    );
    if (!msg.rows[0]) return reply.code(404).send({ error: 'Mensagem não encontrada' });

    // Não pode reportar própria mensagem
    if (msg.rows[0].author_id === userId) {
      return reply.code(400).send({ error: 'Não pode reportar sua própria mensagem' });
    }

    await query(
      `INSERT INTO message_reports (message_id, reporter_id, reason, details)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, reporter_id) DO NOTHING`,
      [messageId, userId, reason, details || null]
    );

    return reply.code(201).send({ ok: true });
  });

  // Listar reports (mods/owner)
  app.get('/clusters/:clusterId/reports', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const { limit = '50', status } = request.query as { limit?: string; status?: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    let sql = `
      SELECT mr.*, m.content, m.created_at as message_created,
        r.username as reporter_username, r.display_name as reporter_display_name,
        u.username as author_username, u.display_name as author_display_name,
        rev.username as reviewer_username
      FROM message_reports mr
      JOIN messages m ON mr.message_id = m.id
      JOIN channels c ON m.channel_id = c.id
      JOIN users r ON mr.reporter_id = r.id
      JOIN users u ON m.author_id = u.id
      LEFT JOIN users rev ON mr.reviewed_by = rev.id
      WHERE c.cluster_id = $1
    `;
    const params: any[] = [clusterId];
    let idx = 2;

    if (status) { sql += ` AND mr.status = $${idx++}`; params.push(status); }

    sql += ` ORDER BY mr.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit, 10));

    const result = await query(sql, params);
    return reply.send({ reports: result.rows });
  });

  // Resolver report
  app.patch('/clusters/:clusterId/reports/:reportId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, reportId } = request.params as { clusterId: string; reportId: string };
    const { status, action } = request.body as { status: 'reviewed' | 'dismissed' | 'actioned'; action?: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    if (!['reviewed', 'dismissed', 'actioned'].includes(status)) {
      return reply.code(400).send({ error: 'Status inválido' });
    }

    await query(
      `UPDATE message_reports 
       SET status = $1, reviewed_by = $2, reviewed_at = now()
       WHERE id = $3 AND (SELECT cluster_id FROM channels c JOIN messages m ON m.channel_id = c.id WHERE m.id = (SELECT message_id FROM message_reports WHERE id = $3)) = $4`,
      [status, userId, reportId, clusterId]
    );

    return reply.send({ ok: true });
  });
}

export { createAutoModRuleSchema, updateAutoModRuleSchema, timeoutSchema, banSchema, reportSchema };