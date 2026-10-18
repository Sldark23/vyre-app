// Tipos compartilhados entre API (Node) e Web (React) do Vyre.

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerColor: string;
  bio: string;
  status: UserStatus;
}

export interface CurrentUser extends PublicUser {
  email: string;
  createdAt: string;
}

export interface Cluster {
  id: string;
  name: string;
  slug: string;
  description: string;
  iconUrl: string | null;
  bannerColor: string;
  ownerId: string;
  inviteCode: string;
  memberCount: number;
  createdAt: string;
}

export interface ClusterMember {
  user: PublicUser;
  nickname: string | null;
  joinedAt: string;
}

export type ChannelType = 'text' | 'voice' | 'announcement' | 'forum';

export interface Channel {
  id: string;
  clusterId: string;
  name: string;
  type: ChannelType;
  topic: string;
  position: number;
  slowmodeSeconds: number;
  locked: boolean;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  author: PublicUser;
  content: string;
  editedAt: string | null;
  replyTo: string | null;
  createdAt: string;
}

// Eventos que o cliente envia pro servidor
export type ClientEvent =
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'typing'; channel: string };

// Eventos que o servidor envia pro cliente
export type ServerEvent =
  | { type: 'ready'; userId: string }
  | { type: 'message:created'; message: Message }
  | { type: 'message:edited'; message: Message }
  | { type: 'message:deleted'; id: string; channelId: string }
  | { type: 'typing'; channel: string; userId: string }
  | { type: 'error'; message: string };

export const MAX_MESSAGE_LENGTH = 4000;
export const MESSAGE_RATE_LIMIT = 30; // mensagens por minuto por usuário
