import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from './auth';

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e63946'),
  position: z.number().int().min(0).default(0),
  permissions: z.number().int().min(0).max(9007199254740991).default(0),
  isDefault: z.boolean().default(false),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
  permissions: z.number().int().min(0).max(9007199254740991).optional(),
});

const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});

const channelPermSchema = z.object({
  roleId: z.string().uuid(),
  allow: z.number().int().min(0).max(9007199254740991).default(0),
  deny: z.number().int().min(0).max(9007199254740991).default(0),
});

export async function roleRoutes(app: FastifyInstance) {
  // ============ CLUSTER ROLES ============

  // Listar papéis do cluster
  app.get('/clusters/:clusterId/roles', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };

    const member = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0]) return reply.code(403).send({ error: 'Não é membro deste cluster' });

    const result = await query(
      `SELECT cr.*, 
        (SELECT COUNT(*) FROM user_cluster_roles ucr WHERE ucr.role_id = cr.id) as member_count
       FROM cluster_roles cr
       WHERE cr.cluster_id = $1
       ORDER BY cr.position DESC`,
      [clusterId]
    );

    return reply.send({ roles: result.rows });
  });

  // Criar papel
  app.post('/clusters/:clusterId/roles', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const parsed = createRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    // Verificar se é owner
    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || member.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode criar papéis' });
    }

    const { name, color, position, permissions, isDefault } = parsed.data;

    // Se isDefault, remover default dos outros
    if (isDefault) {
      await query('UPDATE cluster_roles SET is_default = false WHERE cluster_id = $1', [clusterId]);
    }

    const result = await query(
      `INSERT INTO cluster_roles (cluster_id, name, color, position, permissions, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [clusterId, name, color, position, permissions, isDefault]
    );

    // Log audit
    await query(
      `INSERT INTO audit_logs (cluster_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'role_create', 'role', $3, $4)`,
      [clusterId, userId, result.rows[0].id, JSON.stringify({ name })]
    );

    return reply.code(201).send({ role: result.rows[0] });
  });

  // Atualizar papel
  app.patch('/clusters/:clusterId/roles/:roleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, roleId } = request.params as { clusterId: string; roleId: string };
    const parsed = updateRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || member.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode editar papéis' });
    }

    const { name, color, position, permissions } = parsed.data;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
    if (color !== undefined) { updates.push(`color = $${idx++}`); params.push(color); }
    if (position !== undefined) { updates.push(`position = $${idx++}`); params.push(position); }
    if (permissions !== undefined) { updates.push(`permissions = $${idx++}`); params.push(permissions); }

    if (updates.length === 0) return reply.code(400).send({ error: 'Nenhum campo para atualizar' });

    const result = await query(
      `UPDATE cluster_roles SET ${updates.join(', ')} WHERE id = $${idx++} AND cluster_id = $${idx++} RETURNING *`,
      [...params, roleId, clusterId]
    );

    if (!result.rows[0]) return reply.code(404).send({ error: 'Papel não encontrado' });

    await query(
      `INSERT INTO audit_logs (cluster_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'role_update', 'role', $3, $4)`,
      [clusterId, userId, roleId, JSON.stringify(parsed.data)]
    );

    return reply.send({ role: result.rows[0] });
  });

  // Deletar papel
  app.delete('/clusters/:clusterId/roles/:roleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, roleId } = request.params as { clusterId: string; roleId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || member.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode deletar papéis' });
    }

    // Verificar se é papel default
    const role = await query('SELECT is_default FROM cluster_roles WHERE id = $1 AND cluster_id = $2', [roleId, clusterId]);
    if (role.rows[0]?.is_default) {
      return reply.code(400).send({ error: 'Não pode deletar papel padrão' });
    }

    await query('DELETE FROM cluster_roles WHERE id = $1 AND cluster_id = $2', [roleId, clusterId]);

    await query(
      `INSERT INTO audit_logs (cluster_id, actor_id, action, target_type, target_id)
       VALUES ($1, $2, 'role_delete', 'role', $3)`,
      [clusterId, userId, roleId]
    );

    return reply.send({ ok: true });
  });

  // ============ ASSIGN ROLES ============

  // Atribuir papel a membro
  app.post('/clusters/:clusterId/members/:userId/roles', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, userId: targetUserId } = request.params as { clusterId: string; userId: string };
    const parsed = assignRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { roleId } = parsed.data;

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    // Verificar se papel existe no cluster
    const role = await query('SELECT 1 FROM cluster_roles WHERE id = $1 AND cluster_id = $2', [roleId, clusterId]);
    if (!role.rows[0]) return reply.code(404).send({ error: 'Papel não encontrado' });

    // Verificar se target é membro
    const targetMember = await query('SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    if (!targetMember.rows[0]) return reply.code(404).send({ error: 'Usuário não é membro deste cluster' });

    // Owner não pode ter papel atribuído
    const targetRole = await query('SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2', [clusterId, targetUserId]);
    if (targetRole.rows[0]?.role === 'owner') {
      return reply.code(400).send({ error: 'Não pode atribuir papel ao dono' });
    }

    await query(
      `INSERT INTO user_cluster_roles (cluster_id, user_id, role_id, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cluster_id, user_id, role_id) DO NOTHING`,
      [clusterId, targetUserId, roleId, userId]
    );

    await query(
      `INSERT INTO audit_logs (cluster_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'role_assign', 'user', $3, $4)`,
      [clusterId, userId, targetUserId, JSON.stringify({ roleId })]
    );

    return reply.code(201).send({ ok: true });
  });

  // Remover papel de membro
  app.delete('/clusters/:clusterId/members/:userId/roles/:roleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, userId: targetUserId, roleId } = request.params as { clusterId: string; userId: string; roleId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    await query(
      'DELETE FROM user_cluster_roles WHERE cluster_id = $1 AND user_id = $2 AND role_id = $3',
      [clusterId, targetUserId, roleId]
    );

    await query(
      `INSERT INTO audit_logs (cluster_id, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, 'role_remove', 'user', $3, $4)`,
      [clusterId, userId, targetUserId, JSON.stringify({ roleId })]
    );

    return reply.send({ ok: true });
  });

  // ============ CHANNEL PERMISSIONS ============

  // Listar overrides de permissão do canal
  app.get('/channels/:channelId/permissions', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const result = await query(
      `SELECT crp.*, cr.name as role_name, cr.color as role_color
       FROM channel_role_permissions crp
       JOIN cluster_roles cr ON crp.role_id = cr.id
       WHERE crp.channel_id = $1`,
      [channelId]
    );

    return reply.send({ permissions: result.rows });
  });

  // Definir override de permissão
  app.post('/channels/:channelId/permissions', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const parsed = channelPermSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { roleId, allow, deny } = parsed.data;

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0] || member.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode editar permissões de canal' });
    }

    // Verificar se papel existe no cluster
    const role = await query('SELECT 1 FROM cluster_roles WHERE id = $1 AND cluster_id = (SELECT cluster_id FROM channels WHERE id = $2)', [roleId, channelId]);
    if (!role.rows[0]) return reply.code(404).send({ error: 'Papel não encontrado neste cluster' });

    await query(
      `INSERT INTO channel_role_permissions (channel_id, role_id, allow, deny)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, role_id) DO UPDATE SET allow = $3, deny = $4`,
      [channelId, roleId, allow, deny]
    );

    return reply.code(201).send({ ok: true });
  });

  // Remover override
  app.delete('/channels/:channelId/permissions/:roleId', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId, roleId } = request.params as { channelId: string; roleId: string };

    const channel = await query('SELECT cluster_id FROM channels WHERE id = $1', [channelId]);
    if (!channel.rows[0]) return reply.code(404).send({ error: 'Canal não encontrado' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [channel.rows[0].cluster_id, userId]
    );
    if (!member.rows[0] || member.rows[0].role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono pode remover permissões' });
    }

    await query('DELETE FROM channel_role_permissions WHERE channel_id = $1 AND role_id = $2', [channelId, roleId]);
    return reply.send({ ok: true });
  });

  // ============ AUDIT LOG ============

  // Listar logs de auditoria
  app.get('/clusters/:clusterId/audit-logs', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const { limit = '50', before, action, actorId } = request.query as { 
      limit?: string; before?: string; action?: string; actorId?: string; 
    };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    let sql = `
      SELECT al.*, u.username as actor_username, u.display_name as actor_display_name
      FROM audit_logs al
      JOIN users u ON al.actor_id = u.id
      WHERE al.cluster_id = $1
    `;
    const params: any[] = [clusterId];
    let idx = 2;

    if (action) { sql += ` AND al.action = $${idx++}`; params.push(action); }
    if (actorId) { sql += ` AND al.actor_id = $${idx++}`; params.push(actorId); }
    if (before) { sql += ` AND al.created_at < $${idx++}`; params.push(before); }

    sql += ` ORDER BY al.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit, 10));

    const result = await query(sql, params);
    return reply.send({ logs: result.rows });
  });
}

export { createRoleSchema, updateRoleSchema, assignRoleSchema, channelPermSchema };