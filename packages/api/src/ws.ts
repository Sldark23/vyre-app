import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent, UserStatus } from '@vyre/shared';
import { verifyAccessToken } from './lib/auth';
import {
  channelTopic,
  clusterTopic,
  dmTopic,
  publishTopic,
  redisSub,
  userTopic,
} from './lib/events';
import { query } from './db';
import { announceOffline, announceOnline, setUserStatus, VALID_STATUSES } from './lib/presence';

interface Conn {
  socket: WebSocket;
  userId: string;
  topics: Set<string>;
}

const conns = new Set<Conn>();
const connsByUser = new Map<string, Set<Conn>>();
const topicRefcount = new Map<string, number>();
const membershipCache = new Map<string, { ok: boolean; at: number }>();
const CACHE_TTL = 30_000;
const OFFLINE_DELAY_MS = 5_000;
const offlineTimers = new Map<string, NodeJS.Timeout>();

function cacheGet(key: string): boolean | null {
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.ok;
  return null;
}

async function isChannelMember(channelId: string, userId: string): Promise<boolean> {
  const key = `ch:${channelId}:${userId}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const result = await query(
    `SELECT 1 FROM cluster_members m
     JOIN channels c ON c.cluster_id = m.cluster_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [channelId, userId],
  );
  const ok = result.rows.length > 0;
  membershipCache.set(key, { ok, at: Date.now() });
  return ok;
}

async function isClusterMember(clusterId: string, userId: string): Promise<boolean> {
  const key = `cl:${clusterId}:${userId}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const result = await query(
    `SELECT 1 FROM cluster_members WHERE cluster_id = $1 AND user_id = $2`,
    [clusterId, userId],
  );
  const ok = result.rows.length > 0;
  membershipCache.set(key, { ok, at: Date.now() });
  return ok;
}

async function isDmParticipant(conversationId: string, userId: string): Promise<boolean> {
  const key = `dm:${conversationId}:${userId}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const result = await query(
    `SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  const ok = result.rows.length > 0;
  membershipCache.set(key, { ok, at: Date.now() });
  return ok;
}

/** Valida e assina um tópico pro conn. Retorna false se sem permissão. */
async function addTopic(conn: Conn, raw: string): Promise<boolean> {
  let ok = false;
  if (raw.startsWith('vyre:ch:')) {
    ok = await isChannelMember(raw.slice('vyre:ch:'.length), conn.userId);
  } else if (raw.startsWith('vyre:cluster:')) {
    ok = await isClusterMember(raw.slice('vyre:cluster:'.length), conn.userId);
  } else if (raw.startsWith('vyre:dm:')) {
    ok = await isDmParticipant(raw.slice('vyre:dm:'.length), conn.userId);
  } else if (raw.startsWith('vyre:user:')) {
    ok = raw.slice('vyre:user:'.length) === conn.userId;
  }
  if (!ok) return false;

  if (!conn.topics.has(raw)) {
    conn.topics.add(raw);
    const n = (topicRefcount.get(raw) ?? 0) + 1;
    topicRefcount.set(raw, n);
    if (n === 1) await redisSub.subscribe(raw);
  }
  return true;
}

function removeTopic(conn: Conn, raw: string): void {
  if (!conn.topics.delete(raw)) return;
  const n = (topicRefcount.get(raw) ?? 1) - 1;
  topicRefcount.set(raw, n);
  if (n <= 0) {
    topicRefcount.delete(raw);
    void redisSub.unsubscribe(raw).catch(() => {});
  }
}

function send(conn: Conn, event: ServerEvent | object): void {
  if (conn.socket.readyState === 1) {
    conn.socket.send(JSON.stringify(event));
  }
}

function attachUser(conn: Conn): void {
  let set = connsByUser.get(conn.userId);
  if (!set) {
    set = new Set();
    connsByUser.set(conn.userId, set);
  }
  set.add(conn);
}

async function onFirstConnect(userId: string): Promise<void> {
  const timer = offlineTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    offlineTimers.delete(userId);
  }
  if ((connsByUser.get(userId)?.size ?? 0) > 1) return; // já online em outra sessão
  await announceOnline(userId);
}

async function onLastDisconnect(userId: string): Promise<void> {
  if ((connsByUser.get(userId)?.size ?? 0) > 0) return; // reconectou em outra sessão
  // Espera pra não piscar offline em reconexões rápidas
  const existing = offlineTimers.get(userId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    offlineTimers.delete(userId);
    if ((connsByUser.get(userId)?.size ?? 0) > 0) return;
    try {
      await announceOffline(userId);
    } catch (err) {
      console.error('[ws] erro ao processar desconexão:', err);
    }
  }, OFFLINE_DELAY_MS);
  offlineTimers.set(userId, t);
}

export function registerWs(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const userId = verifyAccessToken(token);
    if (!userId) {
      socket.send(JSON.stringify({ type: 'error', message: 'Não autenticado' } satisfies ServerEvent));
      socket.close(4001, 'unauthenticated');
      return;
    }

    const conn: Conn = { socket, userId, topics: new Set() };
    conns.add(conn);
    attachUser(conn);
    send(conn, { type: 'ready', userId });

    void (async () => {
      // Tópico pessoal (pedidos de amizade, DMs, presença própria)
      await addTopic(conn, userTopic(userId));
      await onFirstConnect(userId);
    })();

    socket.on('message', async (raw: Buffer) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        switch (event.type) {
          case 'subscribe': {
            if (typeof event.channel !== 'string') return;
            if (!(await addTopic(conn, channelTopic(event.channel)))) {
              send(conn, { type: 'error', message: 'Sem acesso a este canal' });
            }
            break;
          }
          case 'unsubscribe': {
            if (typeof event.channel === 'string') removeTopic(conn, channelTopic(event.channel));
            break;
          }
          case 'subscribe-dm': {
            if (typeof event.conversation !== 'string') return;
            if (!(await addTopic(conn, dmTopic(event.conversation)))) {
              send(conn, { type: 'error', message: 'Sem acesso a esta conversa' });
            }
            break;
          }
          case 'unsubscribe-dm': {
            if (typeof event.conversation === 'string') removeTopic(conn, dmTopic(event.conversation));
            break;
          }
          case 'subscribe-cluster': {
            if (typeof event.cluster !== 'string') return;
            if (!(await addTopic(conn, clusterTopic(event.cluster)))) {
              send(conn, { type: 'error', message: 'Sem acesso a este cluster' });
            }
            break;
          }
          case 'unsubscribe-cluster': {
            if (typeof event.cluster === 'string') removeTopic(conn, clusterTopic(event.cluster));
            break;
          }
          case 'typing': {
            if (typeof event.channel !== 'string') return;
            const topic = channelTopic(event.channel);
            if (conn.topics.has(topic)) {
              await publishTopic(topic, { type: 'typing', channel: event.channel, userId });
            }
            break;
          }
          case 'dm-typing': {
            if (typeof event.conversation !== 'string') return;
            const topic = dmTopic(event.conversation);
            if (conn.topics.has(topic)) {
              await publishTopic(topic, { type: 'dm:typing', conversation: event.conversation, userId });
            }
            break;
          }
          case 'presence': {
            if (!VALID_STATUSES.includes(event.status)) return;
            await setUserStatus(userId, event.status as UserStatus);
            break;
          }
        }
      } catch (err) {
        console.error('[ws] erro ao processar evento:', err);
      }
    });

    const cleanup = () => {
      if (!conns.delete(conn)) return;
      const set = connsByUser.get(userId);
      set?.delete(conn);
      if (set && set.size === 0) connsByUser.delete(userId);
      for (const topic of conn.topics) {
        const n = (topicRefcount.get(topic) ?? 1) - 1;
        topicRefcount.set(topic, n);
        if (n <= 0) {
          topicRefcount.delete(topic);
          void redisSub.unsubscribe(topic).catch(() => {});
        }
      }
      conn.topics.clear();
      void onLastDisconnect(userId);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  // Repassa eventos do Redis pra todos os inscritos no tópico
  redisSub.on('message', (topic: string, raw: string) => {
    let event: object;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    for (const conn of conns) {
      if (conn.topics.has(topic)) send(conn, event);
    }
  });

  app.log.info('WebSocket registrado em /ws');
}

export function connectionCount(): number {
  return conns.size;
}
