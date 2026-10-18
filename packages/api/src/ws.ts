import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '@vyre/shared';
import { verifyAccessToken } from './lib/auth';
import { channelTopic, redisSub } from './lib/events';
import { query } from './db';

interface Conn {
  socket: WebSocket;
  userId: string;
  channels: Set<string>;
}

const conns = new Set<Conn>();
const subscribedTopics = new Set<string>();
const membershipCache = new Map<string, { member: boolean; at: number }>();
const CACHE_TTL = 30_000;

async function isMember(channelId: string, userId: string): Promise<boolean> {
  const key = `${channelId}:${userId}`;
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.member;
  const result = await query(
    `SELECT 1 FROM cluster_members m
     JOIN channels c ON c.cluster_id = m.cluster_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [channelId, userId],
  );
  const member = result.rows.length > 0;
  membershipCache.set(key, { member, at: Date.now() });
  return member;
}

function send(conn: Conn, event: ServerEvent) {
  if (conn.socket.readyState === 1) {
    conn.socket.send(JSON.stringify(event));
  }
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

    const conn: Conn = { socket, userId, channels: new Set() };
    conns.add(conn);
    send(conn, { type: 'ready', userId });

    socket.on('message', async (raw: Buffer) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (event.type === 'subscribe' && typeof event.channel === 'string') {
          if (!(await isMember(event.channel, userId))) {
            send(conn, { type: 'error', message: 'Sem acesso a este canal' });
            return;
          }
          conn.channels.add(event.channel);
          const topic = channelTopic(event.channel);
          if (!subscribedTopics.has(topic)) {
            subscribedTopics.add(topic);
            await redisSub.subscribe(topic);
          }
        } else if (event.type === 'unsubscribe' && typeof event.channel === 'string') {
          conn.channels.delete(event.channel);
        } else if (event.type === 'typing' && typeof event.channel === 'string') {
          if (conn.channels.has(event.channel)) {
            const { publishChannel } = await import('./lib/events');
            await publishChannel(event.channel, { type: 'typing', channel: event.channel, userId });
          }
        }
      } catch (err) {
        console.error('[ws] erro ao processar evento:', err);
      }
    });

    socket.on('close', () => {
      conns.delete(conn);
    });
    socket.on('error', () => {
      conns.delete(conn);
    });
  });

  // Repassa eventos do Redis pros inscritos no canal
  redisSub.on('message', (topic: string, raw: string) => {
    const channelId = topic.slice('vyre:ch:'.length);
    let event: ServerEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    for (const conn of conns) {
      if (conn.channels.has(channelId)) send(conn, event);
    }
  });

  app.log.info('WebSocket registrado em /ws');
}

export function connectionCount(): number {
  return conns.size;
}
