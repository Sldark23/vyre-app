import Redis from 'ioredis';
import { env } from '../env';

export const redisPub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
export const redisSub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });

export const channelTopic = (id: string) => `vyre:ch:${id}`;
export const dmTopic = (id: string) => `vyre:dm:${id}`;
export const userTopic = (id: string) => `vyre:user:${id}`;
export const clusterTopic = (id: string) => `vyre:cluster:${id}`;

export async function publishTopic(topic: string, payload: unknown): Promise<void> {
  try {
    await redisPub.publish(topic, JSON.stringify(payload));
  } catch (err) {
    console.error('[redis] falha ao publicar:', err);
  }
}

export async function publishChannel(channelId: string, payload: unknown): Promise<void> {
  await publishTopic(channelTopic(channelId), payload);
}
