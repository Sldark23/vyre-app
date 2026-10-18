import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { VoiceParticipant } from '@vyre/shared';
import { query } from '../db';
import { env } from '../env';
import { requireAuth } from './auth';
import { clusterTopic, publishTopic } from '../lib/events';

/* Token de acesso do LiveKit: JWT HS256 assinado com o segredo da API key
 * (kid no header). Sem dependência do SDK — o formato é JWT puro. */
function livekitAccessToken(userId: string, displayName: string, channelId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: env.livekitKey,
      sub: userId,
      nbf: now - 10,
      exp: now + 6 * 60 * 60, // usado só no join; LiveKit valida na conexão
      name: displayName,
      video: {
        roomJoin: true,
        room: channelId, // nome da sala = id do canal
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    },
    env.livekitSecret,
    { algorithm: 'HS256', keyid: env.livekitKey },
  );
}

async function participantsOf(channelId: string): Promise<VoiceParticipant[]> {
  const result = await query(
    `SELECT v.user_id, u.username, u.display_name, u.avatar_url
     FROM voice_participants v JOIN users u ON u.id = v.user_id
     WHERE v.channel_id = $1 ORDER BY v.joined_at`,
    [channelId],
  );
  return result.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
  }));
}

/* Comuniza a lista atual de voz de um canal no tópico do cluster */
async function broadcastVoice(channelId: string): Promise<void> {
  const ch = await query(`SELECT cluster_id FROM channels WHERE id = $1`, [channelId]);
  const clusterId = ch.rows[0]?.cluster_id;
  if (!clusterId) return;
  await publishTopic(clusterTopic(clusterId), {
    type: 'voice:update',
    channelId,
    participants: await participantsOf(channelId),
  });
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

export async function voiceRoutes(app: FastifyInstance) {
  // Emite token de acesso do LiveKit para entrar na sala do canal de voz
  app.post('/voice/token', async (request, reply) => {
    const userId = requireAuth(request);
    if (!env.livekitKey || !env.livekitSecret) {
      return reply.code(503).send({ error: 'Voz não configurada no servidor' });
    }
    const parsed = z.object({ channelId: z.string().uuid() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const channel = await query(`SELECT * FROM channels WHERE id = $1`, [parsed.data.channelId]);
    const row = channel.rows[0];
    if (!row) return reply.code(404).send({ error: 'Canal não encontrado' });
    if (row.type !== 'voice') return reply.code(400).send({ error: 'Este canal não é de voz' });
    await assertMember(row.cluster_id, userId);

    const user = await query(`SELECT display_name FROM users WHERE id = $1`, [userId]);
    const token = livekitAccessToken(userId, user.rows[0].display_name, row.id);
    return reply.send({ url: env.livekitUrl, token });
  });

  // Participantes atuais de um canal de voz (carga inicial da UI)
  app.get('/voice/:channelId', async (request, reply) => {
    const userId = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const channel = await query(`SELECT * FROM channels WHERE id = $1`, [channelId]);
    const row = channel.rows[0];
    if (!row) return reply.code(404).send({ error: 'Canal não encontrado' });
    await assertMember(row.cluster_id, userId);
    return reply.send({ participants: await participantsOf(channelId) });
  });

  // Webhook do LiveKit (autenticado pelo JWT de webhook, não pelo token de usuário)
  app.post('/voice/webhook', async (request: FastifyRequest, reply) => {
    const rawHeader = request.headers.authorization;
    const raw = rawHeader?.startsWith('Bearer ') ? rawHeader.slice(7) : null;
    if (!raw || !env.livekitKey || !env.livekitSecret) {
      return reply.code(401).send({ error: 'Não autorizado' });
    }
    const header = jwt.decode(raw, { complete: true })?.header as { kid?: string } | null;
    if (header?.kid !== env.livekitKey) return reply.code(401).send({ error: 'Não autorizado' });
    // o LiveKit assina o payload do evento dentro do JWT (o body é redundante)
    let payload: {
      event?: string;
      room?: { name?: string };
      participant?: { sid?: string; identity?: string };
    };
    try {
      payload = jwt.verify(raw, env.livekitSecret, {
        algorithms: ['HS256'],
        clockTolerance: 60,
      }) as typeof payload;
    } catch {
      return reply.code(401).send({ error: 'Não autorizado' });
    }

    const event = payload.event;
    const channelId = payload.room?.name;
    const sid = payload.participant?.sid;
    const identity = payload.participant?.identity;

    try {
      if (event === 'participant_joined' && channelId && sid && identity) {
        await query(
          `INSERT INTO voice_participants (session_id, channel_id, user_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (session_id) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
          [sid, channelId, identity],
        );
        await broadcastVoice(channelId);
      } else if (event === 'participant_left' && sid) {
        const removed = await query(
          `DELETE FROM voice_participants WHERE session_id = $1 RETURNING channel_id`,
          [sid],
        );
        if (removed.rows[0]) await broadcastVoice(removed.rows[0].channel_id);
      } else if (event === 'room_finished' && channelId) {
        await query(`DELETE FROM voice_participants WHERE channel_id = $1`, [channelId]);
        await broadcastVoice(channelId);
      }
      // room_started e eventos de track não mudam estado nosso
    } catch (err) {
      // FK violada (usuário não existe mais) etc — não derruba o webhook
      console.error('[voice] falha ao processar webhook:', err);
    }
    return reply.send({ ok: true });
  });
}
