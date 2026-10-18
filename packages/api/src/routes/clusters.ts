import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { requireAuth } from './auth';
import { toChannel, toCluster, toPublicUser } from '../lib/serialize';
import { clusterTopic, publishTopic, userTopic } from '../lib/events';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'cluster'}-${crypto.randomBytes(3).toString('hex')}`;
}

function inviteCode(): string {
  return crypto.randomBytes(9).toString('base64url');
}

const DEFAULT_CHANNELS = [
  { name: 'geral', type: 'text', topic: 'Conversa geral do cluster', position: 0 },
  { name: 'anúncios', type: 'announcement', topic: 'Avisos oficiais', position: 1 },
  { name: 'off-topic', type: 'text', topic: 'Fique à vontade', position: 2 },
  { name: 'Geral', type: 'voice', topic: '', position: 3 },
];

async function assertMember(clusterId: string, userId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`,
    [clusterId, userId],
  );
  if (!result.rows.length) {
    const err = new Error('Você não é membro deste cluster') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return true;
}

type Role = 'owner' | 'moderator' | 'member';

async function memberRole(clusterId: string, userId: string): Promise<Role | null> {
  const r = await query(`SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`, [
    clusterId,
    userId,
  ]);
  return (r.rows[0]?.role as Role) ?? null;
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/** Dono ou moderador — lança 403 fora. */
async function assertMod(clusterId: string, userId: string): Promise<Role> {
  const role = await memberRole(clusterId, userId);
  if (role !== 'owner' && role !== 'moderator') {
    throw httpError(403, 'Só donos e moderadores podem fazer isso');
  }
  return role;
}

export async function clusterRoutes(app: FastifyInstance) {
  // Lista clusters do usuário (com primeiro canal pra UI)
  app.get('/clusters', async (request, reply) => {
    const userId = requireAuth(request);
    const result = await query(
      `SELECT c.*,
              (SELECT ch.id FROM channels ch WHERE ch.cluster_id = c.id ORDER BY ch.position LIMIT 1) AS first_channel_id
       FROM clusters c
       JOIN cluster_members m ON m.cluster_id = c.id AND m.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId],
    );
    return reply.send({
      clusters: result.rows.map((r) => ({ ...toCluster(r), firstChannelId: r.first_channel_id })),
    });
  });

  // Cria cluster + canais padrão + membership do dono
  app.post('/clusters', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = z
      .object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const { name, description } = parsed.data;

    const cluster = await withTransaction(async (client) => {
      const c = await client.query(
        `INSERT INTO clusters (name, slug, description, owner_id, invite_code)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, slugify(name), description ?? '', userId, inviteCode()],
      );
      const created = c.rows[0];
      await client.query(
        `INSERT INTO cluster_members (cluster_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [created.id, userId],
      );
      for (const ch of DEFAULT_CHANNELS) {
        await client.query(
          `INSERT INTO channels (cluster_id, name, type, topic, position) VALUES ($1,$2,$3,$4,$5)`,
          [created.id, ch.name, ch.type, ch.topic, ch.position],
        );
      }
      return created;
    });

    const channels = await query(`SELECT * FROM channels WHERE cluster_id = $1 ORDER BY position`, [
      cluster.id,
    ]);
    return reply.code(201).send({
      cluster: toCluster(cluster),
      channels: channels.rows.map(toChannel),
    });
  });

  // Entra por código de convite
  app.post('/clusters/join', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = z.object({ code: z.string().min(1).max(64) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Convite inválido' });

    const found = await query(`SELECT * FROM clusters WHERE invite_code = $1`, [parsed.data.code]);
    const cluster = found.rows[0];
    if (!cluster) return reply.code(404).send({ error: 'Convite não encontrado ou expirou' });

    await query(`INSERT INTO cluster_members (cluster_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      cluster.id,
      userId,
    ]);
    await query(`UPDATE clusters SET member_count = (SELECT count(*) FROM cluster_members WHERE cluster_id = $1) WHERE id = $1`, [
      cluster.id,
    ]);
    const first = await query(`SELECT id FROM channels WHERE cluster_id = $1 ORDER BY position LIMIT 1`, [
      cluster.id,
    ]);
    return reply.send({ clusterId: cluster.id, firstChannelId: first.rows[0]?.id ?? null });
  });

  // Detalhe do cluster (membro)
  app.get('/clusters/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    await assertMember(id, userId);

    const [cluster, channels, members] = await Promise.all([
      query(`SELECT * FROM clusters WHERE id = $1`, [id]),
      query(`SELECT * FROM channels WHERE cluster_id = $1 ORDER BY position`, [id]),
      query(
        `SELECT m.nickname, m.joined_at, m.role, u.id, u.username, u.display_name, u.avatar_url,
                u.banner_color, u.bio, u.status
         FROM cluster_members m JOIN users u ON u.id = m.user_id
         WHERE m.cluster_id = $1 ORDER BY u.display_name LIMIT 200`,
        [id],
      ),
    ]);
    if (!cluster.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });

    return reply.send({
      cluster: toCluster(cluster.rows[0]),
      channels: channels.rows.map(toChannel),
      members: members.rows.map((r) => ({
        user: toPublicUser(r),
        nickname: r.nickname,
        joinedAt: r.joined_at,
        role: r.role,
      })),
      isOwner: cluster.rows[0].owner_id === userId,
      myRole: await memberRole(id, userId),
    });
  });

  // Editar cluster (dono)
  app.patch('/clusters/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        bannerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        iconUrl: z.string().url().max(500).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const owner = await query(`SELECT owner_id FROM clusters WHERE id = $1`, [id]);
    if (!owner.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });
    if (owner.rows[0].owner_id !== userId) {
      return reply.code(403).send({ error: 'Só o dono pode editar o cluster' });
    }
    const p = parsed.data;
    const updated = await query(
      `UPDATE clusters SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         banner_color = COALESCE($4, banner_color),
         icon_url = CASE WHEN $5 THEN $6 ELSE icon_url END
       WHERE id = $1 RETURNING *`,
      [id, p.name ?? null, p.description ?? null, p.bannerColor ?? null, 'iconUrl' in p, p.iconUrl ?? null],
    );
    return reply.send({ cluster: toCluster(updated.rows[0]) });
  });

  // Rotação do convite (dono)
  app.post('/clusters/:id/invite', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const owner = await query(`SELECT owner_id FROM clusters WHERE id = $1`, [id]);
    if (!owner.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });
    if (owner.rows[0].owner_id !== userId) return reply.code(403).send({ error: 'Só o dono' });
    const updated = await query(`UPDATE clusters SET invite_code = $1 WHERE id = $2 RETURNING invite_code`, [
      inviteCode(),
      id,
    ]);
    return reply.send({ inviteCode: updated.rows[0].invite_code });
  });

  // Kick (mod+): dono kicka qualquer um; mod kicka só members
  app.delete('/clusters/:id/members/:userId', async (request, reply) => {
    const userId = requireAuth(request);
    const { id, userId: targetId } = request.params as { id: string; userId: string };
    const myRole = await assertMod(id, userId);
    const targetRole = await memberRole(id, targetId);
    if (!targetRole) return reply.code(404).send({ error: 'Membro não encontrado' });
    if (targetRole === 'owner') return reply.code(403).send({ error: 'Não dá pra kickar o dono' });
    if (myRole === 'moderator' && targetRole === 'moderator') {
      return reply.code(403).send({ error: 'Moderadores não podem kickar outros moderadores' });
    }
    await query(`DELETE FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`, [
      id,
      targetId,
    ]);
    await query(
      `UPDATE clusters SET member_count = (SELECT count(*) FROM cluster_members WHERE cluster_id = $1) WHERE id = $1`,
      [id],
    );
    await publishTopic(userTopic(targetId), { type: 'cluster:removed', clusterId: id });
    return reply.send({ ok: true });
  });

  // Papel do membro (só dono): promover/rebaixar moderator/member
  app.put('/clusters/:id/members/:userId/role', async (request, reply) => {
    const userId = requireAuth(request);
    const { id, userId: targetId } = request.params as { id: string; userId: string };
    const parsed = z.object({ role: z.enum(['moderator', 'member']) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Papel inválido' });

    const owner = await query(`SELECT owner_id FROM clusters WHERE id = $1`, [id]);
    if (!owner.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });
    if (owner.rows[0].owner_id !== userId) {
      return reply.code(403).send({ error: 'Só o dono pode alterar papéis' });
    }
    const targetRole = await memberRole(id, targetId);
    if (!targetRole) return reply.code(404).send({ error: 'Membro não encontrado' });
    if (targetRole === 'owner') return reply.code(403).send({ error: 'O papel do dono não muda' });

    await query(`UPDATE cluster_members SET role = $3 WHERE cluster_id = $1 AND user_id = $2`, [
      id,
      targetId,
      parsed.data.role,
    ]);
    return reply.send({ ok: true, role: parsed.data.role });
  });

  // Apagar cluster (dono) — todo mundo recebe cluster:removed
  app.delete('/clusters/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };
    const owner = await query(`SELECT owner_id FROM clusters WHERE id = $1`, [id]);
    if (!owner.rows[0]) return reply.code(404).send({ error: 'Cluster não encontrado' });
    if (owner.rows[0].owner_id !== userId) {
      return reply.code(403).send({ error: 'Só o dono pode apagar o cluster' });
    }
    const members = await query(`SELECT user_id FROM cluster_members WHERE cluster_id = $1`, [id]);
    await query(`DELETE FROM clusters WHERE id = $1`, [id]);
    await publishTopic(clusterTopic(id), { type: 'cluster:removed', clusterId: id });
    for (const m of members.rows) {
      await publishTopic(userTopic(m.user_id), { type: 'cluster:removed', clusterId: id });
    }
    return reply.send({ ok: true });
  });
}
