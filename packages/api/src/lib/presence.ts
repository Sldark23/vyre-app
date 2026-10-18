import type { UserStatus } from '@vyre/shared';
import { query } from '../db';
import { clusterTopic, publishTopic, userTopic } from './events';

export const VALID_STATUSES: UserStatus[] = ['online', 'idle', 'dnd', 'invisible'];

/**
 * Broadcast de presença pra quem precisa saber:
 * - tópicos dos clusters onde ele é membro (member bar)
 * - tópicos dos amigos (lista de amigos)
 * - tópico do próprio usuário (outras sessões dele, enxergam o status real)
 * Status 'invisible' aparece como 'offline' pros outros, igual Discord.
 */
export async function broadcastPresence(
  userId: string,
  status: UserStatus | 'offline',
): Promise<void> {
  const emit = (topic: string, toSelf: boolean) => {
    const out: UserStatus | 'offline' =
      !toSelf && (status === 'invisible' || status === 'offline') ? 'offline' : status;
    return publishTopic(topic, { type: 'presence:update', userId, status: out } as const);
  };

  const [clusters, friends] = await Promise.all([
    query(`SELECT cluster_id FROM cluster_members WHERE user_id = $1`, [userId]),
    query(`SELECT user_a, user_b FROM friendships WHERE user_a = $1 OR user_b = $1`, [userId]),
  ]);

  const jobs: Promise<void>[] = [emit(userTopic(userId), true)];
  for (const row of clusters.rows) jobs.push(emit(clusterTopic(row.cluster_id), false));
  for (const row of friends.rows) {
    const friendId = row.user_a === userId ? row.user_b : row.user_a;
    jobs.push(emit(userTopic(friendId), false));
  }
  await Promise.all(jobs);
}

/** Escolha explícita de status (menu do usuário): grava no banco e faz broadcast. */
export async function setUserStatus(userId: string, status: UserStatus): Promise<void> {
  await query(`UPDATE users SET status = $1 WHERE id = $2`, [status, userId]);
  await broadcastPresence(userId, status);
}

/** Usuário ficou online: lê o status escolhido dele e anuncia. */
export async function announceOnline(userId: string): Promise<void> {
  const r = await query(`SELECT status FROM users WHERE id = $1`, [userId]);
  const status = (r.rows[0]?.status as UserStatus | undefined) ?? 'online';
  await broadcastPresence(userId, status);
}

/** Última sessão caiu: anuncia offline (guarda o status escolhido no banco). */
export async function announceOffline(userId: string): Promise<void> {
  await broadcastPresence(userId, 'offline');
}
