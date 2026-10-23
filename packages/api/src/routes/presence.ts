import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from './auth';

const updateActivitySchema = z.object({
  type: z.enum(['playing', 'streaming', 'listening', 'custom']).optional(),
  name: z.string().max(128).optional(),
  state: z.string().max(128).optional(),
  details: z.string().max(128).optional(),
  url: z.string().url().optional(),
});

const updateProfileSchema = z.object({
  profilePublic: z.boolean().optional(),
  profileSlug: z.string().max(50).regex(/^[a-z0-9_-]+$/).optional(),
});

export async function presenceRoutes(app: FastifyInstance) {
  // ============ USER ACTIVITY / RICH PRESENCE ============

  // Atualizar atividade do próprio usuário
  app.patch('/users/me/activity', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = updateActivitySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { type, name, state, details, url } = parsed.data;

    // Se type não fornecido mas name sim, default para 'custom'
    const activityType = type || (name ? 'custom' : null);
    if (!activityType && !name) {
      // Limpar atividade
      await query('DELETE FROM user_activities WHERE user_id = $1', [userId]);
      return reply.send({ ok: true, cleared: true });
    }

    await query(
      `INSERT INTO user_activities (user_id, type, name, state, details, url, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         type = EXCLUDED.type,
         name = EXCLUDED.name,
         state = EXCLUDED.state,
         details = EXCLUDED.details,
         url = EXCLUDED.url,
         updated_at = now()`,
      [userId, activityType, name || null, state || null, details || null, url || null]
    );

    return reply.send({ ok: true });
  });

  // Obter atividade do próprio usuário
  app.get('/users/me/activity', async (request, reply) => {
    const userId = requireAuth(request);

    const result = await query(
      'SELECT * FROM user_activities WHERE user_id = $1',
      [userId]
    );

    return reply.send({ activity: result.rows[0] || null });
  });

  // Obter atividade de outro usuário (se público)
  app.get('/users/:userId/activity', async (request, reply) => {
    const userId = requireAuth(request);
    const { userId: targetUserId } = request.params as { userId: string };

    // Verificar se são amigos ou mesmo cluster
    const friendship = await query(
      `SELECT 1 FROM friendships 
       WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)`,
      [userId, targetUserId]
    );

    const sameCluster = await query(
      `SELECT 1 FROM cluster_members cm1
       JOIN cluster_members cm2 ON cm1.cluster_id = cm2.cluster_id
       WHERE cm1.user_id = $1 AND cm2.user_id = $2`,
      [userId, targetUserId]
    );

    if (!friendship.rows[0] && !sameCluster.rows[0] && userId !== targetUserId) {
      return reply.code(403).send({ error: 'Atividade não pública' });
    }

    const result = await query(
      'SELECT * FROM user_activities WHERE user_id = $1',
      [targetUserId]
    );

    return reply.send({ activity: result.rows[0] || null });
  });

  // Limpar atividade
  app.delete('/users/me/activity', async (request, reply) => {
    const userId = requireAuth(request);
    await query('DELETE FROM user_activities WHERE user_id = $1', [userId]);
    return reply.send({ ok: true });
  });

  // ============ PUBLIC PROFILES ============

  // Atualizar configurações de perfil público
  app.patch('/users/me/public-profile', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { profilePublic, profileSlug } = parsed.data;

    const updates: string[] = [];
    const params: any[] = [userId];
    let idx = 2;

    if (profilePublic !== undefined) {
      updates.push(`profile_public = $${idx++}`);
      params.push(profilePublic);
    }
    if (profileSlug !== undefined) {
      // Verificar se slug já existe
      const existing = await query(
        'SELECT 1 FROM users WHERE profile_slug = $1 AND id <> $2',
        [profileSlug, userId]
      );
      if (existing.rows[0]) {
        return reply.code(409).send({ error: 'Este slug já está em uso' });
      }
      updates.push(`profile_slug = $${idx++}`);
      params.push(profileSlug || null);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar' });
    }

    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    return reply.send({ ok: true });
  });

  // Obter perfil público (sem auth)
  app.get('/public/users/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const result = await query(
      `SELECT id, username, display_name, avatar_url, banner_color, bio, 
        profile_public, profile_slug, plus, created_at
       FROM users 
       WHERE profile_slug = $1 AND profile_public = true`,
      [slug]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Perfil não encontrado ou não público' });
    }

    const user = result.rows[0];

    // Buscar clusters públicos em comum (opcional)
    // Buscar badges
    // Buscar atividade atual
    const activity = await query(
      'SELECT type, name, state, details, url FROM user_activities WHERE user_id = $1',
      [user.id]
    );

    return reply.send({
      user: {
        ...user,
        activity: activity.rows[0] || null,
      }
    });
  });

  // Buscar perfil público por username (fallback)
  app.get('/public/users/by-username/:username', async (request, reply) => {
    const { username } = request.params as { username: string };

    const result = await query(
      `SELECT id, username, display_name, avatar_url, banner_color, bio, 
        profile_public, profile_slug, plus, created_at
       FROM users 
       WHERE username = $1 AND profile_public = true`,
      [username]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Perfil não encontrado ou não público' });
    }

    const user = result.rows[0];
    const activity = await query(
      'SELECT type, name, state, details, url FROM user_activities WHERE user_id = $1',
      [user.id]
    );

    return reply.send({
      user: {
        ...user,
        activity: activity.rows[0] || null,
      }
    });
  });
}

export { updateActivitySchema, updateProfileSchema };