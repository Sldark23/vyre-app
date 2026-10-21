import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FriendEntry, FriendRequestEntry, PublicProfile } from '@vyre/shared';
import { query } from '../db';
import { requireAuth } from './auth';
import { toPublicUser } from '../lib/serialize';
import { publishTopic, userTopic } from '../lib/events';
import { rateLimit } from '../lib/rateLimit';

// Par normalizado (menor id primeiro) pro CHECK (user_a < user_b)
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const [x, y] = normalizePair(a, b);
  const r = await query(`SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2`, [x, y]);
  return r.rows.length > 0;
}

async function createFriendship(a: string, b: string): Promise<void> {
  const [x, y] = normalizePair(a, b);
  await query(
    `INSERT INTO friendships (user_a, user_b) VALUES ($1, $2)
     ON CONFLICT (user_a, user_b) DO NOTHING`,
    [x, y],
  );
}

export async function friendRoutes(app: FastifyInstance) {
  // Lista: amigos + pedidos recebidos + pedidos enviados
  app.get('/friends', async (request, reply) => {
    const userId = requireAuth(request);

    const friends = await query(
      `SELECT f.created_at AS since,
              CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END AS friend_id,
              u.*
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = $1 OR f.user_b = $1
       ORDER BY u.display_name ASC`,
      [userId],
    );
    const incoming = await query(
      `SELECT fr.id AS request_id, fr.created_at AS requested_at, u.*
       FROM friend_requests fr JOIN users u ON u.id = fr.from_user
       WHERE fr.to_user = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId],
    );
    const outgoing = await query(
      `SELECT fr.id AS request_id, fr.created_at AS requested_at, u.*
       FROM friend_requests fr JOIN users u ON u.id = fr.to_user
       WHERE fr.from_user = $1 AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`,
      [userId],
    );

    const friendList: FriendEntry[] = friends.rows.map((r) => ({
      user: toPublicUser(r),
      since: r.since,
    }));
    const mapReq = (r: Record<string, unknown>): FriendRequestEntry => ({
      id: r.request_id as string,
      user: toPublicUser(r),
      createdAt: r.requested_at as string,
    });
    return reply.send({
      friends: friendList,
      incoming: incoming.rows.map(mapReq),
      outgoing: outgoing.rows.map(mapReq),
    });
  });

  // Enviar pedido de amizade por username (auto-aceita se já há pedido inverso)
  app.post('/friends/requests', async (request, reply) => {
    const userId = requireAuth(request);
    if (!rateLimit(`freq:${userId}`, 20)) {
      return reply.code(429).send({ error: 'Muitas tentativas, tente em instantes' });
    }
    const parsed = z.object({ username: z.string().min(1).max(64) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Informe o username' });

    const target = await query(`SELECT * FROM users WHERE username = $1`, [
      parsed.data.username.toLowerCase(),
    ]);
    const user = target.rows[0];
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
    if (user.id === userId) return reply.code(400).send({ error: 'Você não pode se adicionar' });

    if (await areFriends(userId, user.id)) {
      return reply.code(409).send({ error: 'Vocês já são amigos' });
    }

    // Já existe pedido inverso? Aceita automaticamente
    const reverse = await query(
      `SELECT id FROM friend_requests WHERE from_user = $1 AND to_user = $2 AND status = 'pending'`,
      [user.id, userId],
    );
    if (reverse.rows[0]) {
      await query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [
        reverse.rows[0].id,
      ]);
      await createFriendship(userId, user.id);
      const me = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
      await Promise.all([
        publishTopic(userTopic(user.id), { type: 'friend:accepted', user: toPublicUser(me.rows[0]) }),
        publishTopic(userTopic(userId), { type: 'friend:accepted', user: toPublicUser(user) }),
      ]);
      return reply.send({ accepted: true });
    }

    const exists = await query(
      `SELECT 1 FROM friend_requests
       WHERE ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))
         AND status = 'pending'`,
      [userId, user.id],
    );
    if (exists.rows.length) {
      return reply.code(409).send({ error: 'Já existe um pedido de amizade entre vocês' });
    }

    const created = await query(
      `INSERT INTO friend_requests (from_user, to_user) VALUES ($1, $2)
       ON CONFLICT (from_user, to_user) DO UPDATE SET status = 'pending', created_at = now()
       RETURNING id, created_at`,
      [userId, user.id],
    );
    const me = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    await publishTopic(userTopic(user.id), {
      type: 'friend:request',
      from: toPublicUser(me.rows[0]),
    });
    return reply.code(201).send({ id: created.rows[0].id });
  });

  // Aceitar pedido
  app.post('/friends/requests/:id/accept', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const req = await query(
      `SELECT * FROM friend_requests WHERE id = $1 AND to_user = $2 AND status = 'pending'`,
      [id, userId],
    );
    const fr = req.rows[0];
    if (!fr) return reply.code(404).send({ error: 'Pedido não encontrado' });

    await query(`UPDATE friend_requests SET status = 'accepted' WHERE id = $1`, [id]);
    await createFriendship(userId, fr.from_user);
    const [me, other] = await Promise.all([
      query(`SELECT * FROM users WHERE id = $1`, [userId]),
      query(`SELECT * FROM users WHERE id = $1`, [fr.from_user]),
    ]);
    await Promise.all([
      publishTopic(userTopic(fr.from_user), { type: 'friend:accepted', user: toPublicUser(me.rows[0]) }),
      publishTopic(userTopic(userId), { type: 'friend:accepted', user: toPublicUser(other.rows[0]) }),
    ]);
    return reply.send({ ok: true });
  });

  // Recusar (destinatário) ou cancelar (remetente) pedido
  app.post('/friends/requests/:id/decline', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const r = await query(
      `DELETE FROM friend_requests
       WHERE id = $1 AND (to_user = $2 OR from_user = $2) AND status = 'pending'
       RETURNING id`,
      [id, userId],
    );
    if (!r.rows.length) return reply.code(404).send({ error: 'Pedido não encontrado' });
    return reply.send({ ok: true });
  });

  // Desfazer amizade
  app.delete('/friends/:userId', async (request, reply) => {
    const userId = requireAuth(request);
    const { userId: otherId } = request.params as { userId: string };
    const [x, y] = normalizePair(userId, otherId);
    const r = await query(`DELETE FROM friendships WHERE user_a = $1 AND user_b = $2 RETURNING user_a`, [
      x,
      y,
    ]);
    if (!r.rows.length) return reply.code(404).send({ error: 'Amizade não encontrada' });
    await Promise.all([
      publishTopic(userTopic(otherId), { type: 'friend:removed', userId }),
      publishTopic(userTopic(userId), { type: 'friend:removed', userId: otherId }),
    ]);
    return reply.send({ ok: true });
  });

  // Perfil público
  app.get('/users/:username', async (request, reply) => {
    const userId = requireAuth(request);
    const { username } = request.params as { username: string };
    const r = await query(`SELECT * FROM users WHERE username = $1`, [username.toLowerCase()]);
    const user = r.rows[0];
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });

    let relationship: PublicProfile['relationship'] = 'none';
    if (user.id !== userId) {
      if (await areFriends(userId, user.id)) relationship = 'friends';
      else {
        const req = await query(
          `SELECT 1 FROM friend_requests
           WHERE status = 'pending'
             AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))`,
          [userId, user.id],
        );
        if (req.rows.length) {
          const outgoing = await query(
            `SELECT 1 FROM friend_requests WHERE from_user = $1 AND to_user = $2 AND status = 'pending'`,
            [userId, user.id],
          );
          relationship = outgoing.rows.length ? 'pending_out' : 'pending_in';
        }
      }
    }

    const shared = await query(
      `SELECT count(*)::int AS n FROM cluster_members m1
       JOIN cluster_members m2 ON m2.cluster_id = m1.cluster_id AND m2.user_id = $2
       WHERE m1.user_id = $1`,
      [userId, user.id],
    );

    return reply.send({
      profile: {
        user: toPublicUser(user),
        bio: user.bio,
        relationship,
        sharedClusters: shared.rows[0]?.n ?? 0,
        createdAt: user.created_at,
      } satisfies PublicProfile,
    });
  });

  // Editar meu perfil
  app.patch('/users/me', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = z
      .object({
        displayName: z.string().min(1).max(64).optional(),
        bio: z.string().max(190).optional(),
        bannerColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #rrggbb)')
          .optional(),
        avatarUrl: z.string().max(500).nullable().optional(),
        customStatus: z.string().max(64).nullable().optional(),
        status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
    }
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [userId];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (d.displayName !== undefined) add('display_name', d.displayName.trim());
    if (d.bio !== undefined) add('bio', d.bio.trim());
    if (d.bannerColor !== undefined) add('banner_color', d.bannerColor.toLowerCase());
    if (d.avatarUrl !== undefined) add('avatar_url', d.avatarUrl);
    if (d.customStatus !== undefined) add('custom_status', d.customStatus?.trim() || null);
    if (d.status !== undefined) add('status', d.status);
    if (!sets.length) return reply.code(400).send({ error: 'Nada para atualizar' });

    const r = await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    const user = r.rows[0];

    if (d.status !== undefined) {
      const { broadcastPresence } = await import('../lib/presence');
      await broadcastPresence(userId, d.status);
    }
    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        bannerColor: user.banner_color,
        bio: user.bio,
        status: user.status,
        customStatus: user.custom_status,
        plus: !!user.plus_until && new Date(user.plus_until as string).getTime() > Date.now(),
        createdAt: user.created_at,
      },
    });
  });
}
