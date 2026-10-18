import type { Cluster, Channel, Message, PublicUser } from '@vyre/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toPublicUser(row: any): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bannerColor: row.banner_color,
    bio: row.bio,
    status: row.status,
  };
}

// Mapeia um row de JOIN messages+users (colunas u_*)
export function rowToMessage(row: any): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    content: row.content,
    editedAt: row.edited_at,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    author: {
      id: row.u_id,
      username: row.u_username,
      displayName: row.u_display_name,
      avatarUrl: row.u_avatar_url,
      bannerColor: row.u_banner_color,
      bio: row.u_bio,
      status: row.u_status,
    },
  };
}

export function toCluster(row: any): Cluster {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    iconUrl: row.icon_url,
    bannerColor: row.banner_color,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

export function toChannel(row: any): Channel {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    name: row.name,
    type: row.type,
    topic: row.topic,
    position: row.position,
    slowmodeSeconds: row.slowmode_seconds,
    locked: row.locked,
    createdAt: row.created_at,
  };
}

export const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.content, m.edited_at, m.reply_to, m.created_at,
         u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
         u.avatar_url AS u_avatar_url, u.banner_color AS u_banner_color,
         u.bio AS u_bio, u.status AS u_status
  FROM messages m
  JOIN users u ON u.id = m.author_id
`;
