import Redis from 'ioredis';
import { env } from '../env';

export const redisPub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
export const redisSub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });

export const channelTopic = (channelId: string) => `vyre:ch:${channelId}`;

export async function publishChannel(channelId: string, payload: unknown): Promise<void> {
  try {
    await redisPub.publish(channelTopic(channelId), JSON.stringify(payload));
  } catch (err) {
    console.error('[redis] falha ao publicar:', err);
  }
}
