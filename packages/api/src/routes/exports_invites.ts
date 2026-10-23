import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { requireAuth } from './auth';
import { env } from '../env';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const exportSchema = z.object({
  includeMessages: z.boolean().default(true),
  includeDMs: z.boolean().default(true),
  includeClusters: z.boolean().default(true),
  includeFriends: z.boolean().default(true),
  includeSettings: z.boolean().default(true),
  format: z.enum(['json', 'zip']).default('json'),
});

const createInviteSchema = z.object({
  maxUses: z.number().int().min(1).max(1000).optional(),
  maxAge: z.number().int().min(60).max(31536000).optional(), // 1 min a 1 ano
  temporary: z.boolean().default(false),
  targetRoleId: z.string().uuid().optional(),
});

export async function exportInviteRoutes(app: FastifyInstance) {
  // ============ DATA EXPORT (LGPD/GDPR) ============

  // Solicitar exportação de dados
  app.post('/users/me/export', async (request, reply) => {
    const userId = requireAuth(request);
    const parsed = exportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const { includeMessages, includeDMs, includeClusters, includeFriends, includeSettings, format } = parsed.data;

    // Verificar se já tem exportação pendente
    const pending = await query(
      `SELECT 1 FROM data_exports 
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [userId]
    );
    if (pending.rows[0]) {
      return reply.code(409).send({ error: 'Já existe uma exportação em andamento' });
    }

    const result = await query(
      `INSERT INTO data_exports (user_id, status, expires_at)
       VALUES ($1, 'pending', now() + interval '7 days')
       RETURNING *`,
      [userId]
    );

    const exportId = result.rows[0].id;

    // Processar em background (simulado - em produção usaria job queue)
    processExport(exportId, userId, {
      includeMessages,
      includeDMs,
      includeClusters,
      includeFriends,
      includeSettings,
      format,
    }).catch(err => console.error('Export error:', err));

    return reply.code(202).send({ 
      exportId, 
      status: 'pending',
      message: 'Exportação iniciada. Verifique o status em GET /users/me/export/:id' 
    });
  });

  // Verificar status da exportação
  app.get('/users/me/export/:id', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };

    const result = await query(
      'SELECT * FROM data_exports WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (!result.rows[0]) return reply.code(404).send({ error: 'Exportação não encontrada' });

    return reply.send({ export: result.rows[0] });
  });

  // Listar exportações
  app.get('/users/me/exports', async (request, reply) => {
    const userId = requireAuth(request);

    const result = await query(
      'SELECT * FROM data_exports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );

    return reply.send({ exports: result.rows });
  });

  // Download do arquivo de exportação
  app.get('/users/me/export/:id/download', async (request, reply) => {
    const userId = requireAuth(request);
    const { id } = request.params as { id: string };

    const result = await query(
      'SELECT * FROM data_exports WHERE id = $1 AND user_id = $2 AND status = $3',
      [id, userId, 'ready']
    );

    if (!result.rows[0]) return reply.code(404).send({ error: 'Exportação não pronta ou não encontrada' });

    const exportData = result.rows[0];
    
    // Verificar expiração
    if (exportData.expires_at && new Date(exportData.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Link de download expirado' });
    }

    if (!exportData.file_path) {
      return reply.code(404).send({ error: 'Arquivo não encontrado' });
    }

    try {
      const filePath = exportData.file_path;
      const stat = await fs.stat(filePath);
      
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', stat.size);
      reply.header('Content-Disposition', `attachment; filename="vyre-export-${id}.json"`);
      
      const stream = (await import('node:fs')).createReadStream(filePath);
      return reply.send(stream);
    } catch (err) {
      return reply.code(404).send({ error: 'Arquivo não encontrado' });
    }
  });

  // ============ CLUSTER INVITES ENHANCEMENT ============

  // Criar convite avançado
  app.post('/clusters/:clusterId/invites', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId } = request.params as { clusterId: string };
    const parsed = createInviteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    const { maxUses, maxAge, temporary, targetRoleId } = parsed.data;

    // Gerar código único
    const code = crypto.randomBytes(6).toString('base64url');
    const expiresAt = maxAge ? new Date(Date.now() + maxAge * 1000).toISOString() : null;

    // Se targetRoleId, verificar se papel existe no cluster
    if (targetRoleId) {
      const role = await query(
        'SELECT 1 FROM cluster_roles WHERE id = $1 AND cluster_id = $2',
        [targetRoleId, clusterId]
      );
      if (!role.rows[0]) return reply.code(404).send({ error: 'Papel não encontrado' });
    }

    const result = await query(
      `INSERT INTO cluster_invites (cluster_id, code, creator_id, max_uses, max_age, temporary, target_role_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [clusterId, code, userId, maxUses || null, maxAge || null, temporary, targetRoleId || null, expiresAt]
    );

    const invite = result.rows[0];
    const publicUrl = `${env.publicUrl}/invite/${invite.code}`;

    return reply.code(201).send({ 
      invite: {
        ...invite,
        url: publicUrl,
      }
    });
  });

  // Listar convites do cluster
  app.get('/clusters/:clusterId/invites', async (request, reply) => {
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
      `SELECT ci.*, u.username as creator_username,
        (SELECT COUNT(*) FROM cluster_members cm WHERE cm.cluster_id = ci.cluster_id AND cm.joined_at > ci.created_at AND cm.user_id IN (SELECT user_id FROM cluster_members WHERE cluster_id = ci.cluster_id)) as estimated_uses
       FROM cluster_invites ci
       JOIN users u ON ci.creator_id = u.id
       WHERE ci.cluster_id = $1
       ORDER BY ci.created_at DESC`,
      [clusterId]
    );

    return reply.send({ invites: result.rows });
  });

  // Deletar/revocar convite
  app.delete('/clusters/:clusterId/invites/:inviteId', async (request, reply) => {
    const userId = requireAuth(request);
    const { clusterId, inviteId } = request.params as { clusterId: string; inviteId: string };

    const member = await query(
      'SELECT role FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [clusterId, userId]
    );
    if (!member.rows[0] || !['owner', 'moderator'].includes(member.rows[0].role)) {
      return reply.code(403).send({ error: 'Sem permissão' });
    }

    await query('DELETE FROM cluster_invites WHERE id = $1 AND cluster_id = $2', [inviteId, clusterId]);
    return reply.send({ ok: true });
  });

  // Validar convite (público - para preview antes de entrar)
  app.get('/invites/:code', async (request, reply) => {
    const { code } = request.params as { code: string };

    const result = await query(
      `SELECT ci.*, c.name as cluster_name, c.description as cluster_description, c.icon_url, c.member_count,
        u.username as creator_username
       FROM cluster_invites ci
       JOIN clusters c ON ci.cluster_id = c.id
       JOIN users u ON ci.creator_id = u.id
       WHERE ci.code = $1`,
      [code]
    );

    if (!result.rows[0]) return reply.code(404).send({ error: 'Convite inválido' });

    const invite = result.rows[0];

    // Verificar expiração
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Convite expirado' });
    }

    // Verificar usos
    if (invite.max_uses && invite.uses >= invite.max_uses) {
      return reply.code(410).send({ error: 'Convite esgotado' });
    }

    // Não expor informações sensíveis
    return reply.send({
      invite: {
        code: invite.code,
        cluster_name: invite.cluster_name,
        cluster_description: invite.cluster_description,
        cluster_icon: invite.icon_url,
        member_count: invite.member_count,
        creator_username: invite.creator_username,
        max_uses: invite.max_uses,
        uses: invite.uses,
        temporary: invite.temporary,
        expires_at: invite.expires_at,
      }
    });
  });

  // Entrar via convite (usa o endpoint existente /clusters/join mas valida campos extras)
  app.post('/invites/:code/join', async (request, reply) => {
    const userId = requireAuth(request);
    const { code } = request.params as { code: string };

    const inviteResult = await query(
      `SELECT * FROM cluster_invites WHERE code = $1`,
      [code]
    );

    if (!inviteResult.rows[0]) return reply.code(404).send({ error: 'Convite inválido' });

    const invite = inviteResult.rows[0];

    // Verificar expiração
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Convite expirado' });
    }

    // Verificar usos
    if (invite.max_uses && invite.uses >= invite.max_uses) {
      return reply.code(410).send({ error: 'Convite esgotado' });
    }

    // Verificar se já é membro
    const existing = await query(
      'SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2',
      [invite.cluster_id, userId]
    );
    if (existing.rows[0]) {
      return reply.code(409).send({ error: 'Já é membro deste cluster' });
    }

    // Verificar ban
    const ban = await query(
      'SELECT 1 FROM member_bans WHERE cluster_id = $1 AND user_id = $2 AND (expires_at IS NULL OR expires_at > now())',
      [invite.cluster_id, userId]
    );
    if (ban.rows[0]) {
      return reply.code(403).send({ error: 'Banido deste cluster' });
    }

    // Adicionar membro
    const targetRole = invite.target_role_id ? (await query(
      'SELECT name FROM cluster_roles WHERE id = $1',
      [invite.target_role_id]
    )).rows[0]?.name : 'member';

    await query(
      `INSERT INTO cluster_members (cluster_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (cluster_id, user_id) DO NOTHING`,
      [invite.cluster_id, userId, targetRole]
    );

    // Incrementar uses
    await query(
      'UPDATE cluster_invites SET uses = uses + 1 WHERE id = $1',
      [invite.id]
    );

    // Atualizar member_count
    await query(
      'UPDATE clusters SET member_count = member_count + 1 WHERE id = $1',
      [invite.cluster_id]
    );

    // Se temporary, marcar para remoção ao sair (implementar via WS disconnect)
    // TODO: Implementar limpeza automática

    return reply.send({ ok: true, clusterId: invite.cluster_id });
  });
}

async function processExport(
  exportId: string,
  userId: string,
  options: {
    includeMessages: boolean;
    includeDMs: boolean;
    includeClusters: boolean;
    includeFriends: boolean;
    includeSettings: boolean;
    format: 'json' | 'zip';
  }
) {
  try {
    await query(
      'UPDATE data_exports SET status = $1 WHERE id = $2',
      ['processing', exportId]
    );

    const data: any = {
      exportInfo: {
        exportedAt: new Date().toISOString(),
        userId,
        format: 'v1',
      },
    };

    // Profile
    const profile = await query(
      `SELECT id, username, display_name, email, avatar_url, banner_color, bio, status, custom_status, plus, plus_until, profile_public, profile_slug, created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    data.profile = profile.rows[0];

    if (options.includeSettings) {
      // Settings would be stored elsewhere or computed
    }

    if (options.includeClusters) {
      const clusters = await query(
        `SELECT c.*, cm.role, cm.nickname, cm.joined_at
         FROM clusters c
         JOIN cluster_members cm ON c.id = cm.cluster_id
         WHERE cm.user_id = $1`,
        [userId]
      );
      data.clusters = clusters.rows;
    }

    if (options.includeFriends) {
      const friends = await query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, u.plus, f.created_at as friend_since
         FROM friendships f
         JOIN users u ON (u.id = f.user_a OR u.id = f.user_b) AND u.id <> $1
         WHERE f.user_a = $1 OR f.user_b = $1`,
        [userId]
      );
      data.friends = friends.rows;
    }

    if (options.includeMessages) {
      const messages = await query(
        `SELECT m.*, c.name as channel_name, c.cluster_id
         FROM messages m
         JOIN channels c ON m.channel_id = c.id
         JOIN cluster_members cm ON c.cluster_id = cm.cluster_id
         WHERE cm.user_id = $1
         ORDER BY m.created_at DESC
         LIMIT 10000`,
        [userId]
      );
      data.messages = messages.rows;
    }

    if (options.includeDMs) {
      const dms = await query(
        `SELECT dmc.*, u.username, u.display_name, u.avatar_url
         FROM dm_conversations dmc
         JOIN dm_participants dp ON dmc.id = dp.conversation_id
         JOIN users u ON dp.user_id = u.id
         WHERE dp.user_id = $1`,
        [userId]
      );
      data.dmConversations = dms.rows;

      for (const conv of data.dmConversations) {
        const msgs = await query(
          `SELECT dm.*, u.username, u.display_name
           FROM dm_messages dm
           JOIN users u ON dm.author_id = u.id
           WHERE dm.conversation_id = $1
           ORDER BY dm.created_at ASC
           LIMIT 5000`,
          [conv.id]
        );
        conv.messages = msgs.rows;
      }
    }

    // Salvar arquivo
    const uploadsDir = path.join(process.cwd(), '..', 'uploads', 'exports');
    await fs.mkdir(uploadsDir, { recursive: true });

    const fileName = `vyre-export-${exportId}.json`;
    const filePath = path.join(uploadsDir, fileName);

    const jsonData = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonData, 'utf-8');

    await query(
      `UPDATE data_exports SET status = $1, file_path = $2, completed_at = now() WHERE id = $3`,
      ['ready', filePath, exportId]
    );
  } catch (err) {
    console.error('Export processing error:', err);
    await query(
      `UPDATE data_exports SET status = $1 WHERE id = $2`,
      ['failed', exportId]
    );
  }
}

export { exportSchema, createInviteSchema };