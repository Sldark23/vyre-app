// Tipos compartilhados entre API (Node) e Web (React) do Vyre.

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible';
/** Status exibível: inclui 'offline' (derivado da presença ao vivo) */
export type DisplayStatus = UserStatus | 'offline';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bannerColor: string;
  bio: string;
  status: DisplayStatus;
  customStatus: string | null;
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

// ============ Fase 2: amizades, DMs e presença ============

export interface FriendEntry {
  user: PublicUser;
  since: string;
}

export interface FriendRequestEntry {
  id: string;
  user: PublicUser;
  createdAt: string;
}

export interface DMConversation {
  id: string;
  isGroup: boolean;
  name: string | null;
  participants: PublicUser[];
  lastMessage: Message | null;
  createdAt: string;
}

export type RelationshipState = 'none' | 'pending_out' | 'pending_in' | 'friends';

export interface PublicProfile {
  user: PublicUser;
  bio: string;
  relationship: RelationshipState;
  sharedClusters: number;
  createdAt: string;
}

// Eventos que o cliente envia pra servidor
export type ClientEvent =
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'typing'; channel: string }
  | { type: 'subscribe-dm'; conversation: string }
  | { type: 'unsubscribe-dm'; conversation: string }
  | { type: 'dm-typing'; conversation: string }
  | { type: 'subscribe-cluster'; cluster: string }
  | { type: 'unsubscribe-cluster'; cluster: string }
  | { type: 'presence'; status: UserStatus };

// Eventos que o servidor envia pro cliente
export type ServerEvent =
  | { type: 'ready'; userId: string }
  | { type: 'message:created'; message: Message }
  | { type: 'message:edited'; message: Message }
  | { type: 'message:deleted'; id: string; channelId: string }
  | { type: 'typing'; channel: string; userId: string }
  | { type: 'friend:request'; from: PublicUser }
  | { type: 'friend:accepted'; user: PublicUser }
  | { type: 'friend:removed'; userId: string }
  | { type: 'dm:created'; conversation: DMConversation }
  | { type: 'dm:typing'; conversation: string; userId: string }
  | { type: 'dm:message:created'; conversationId: string; message: Message }
  | { type: 'dm:message:edited'; conversationId: string; message: Message }
  | { type: 'dm:message:deleted'; conversationId: string; id: string }
  | { type: 'presence:update'; userId: string; status: UserStatus | 'offline' }
  | { type: 'error'; message: string };

export const MAX_MESSAGE_LENGTH = 4000;
export const MESSAGE_RATE_LIMIT = 30; // mensagens por minuto por usuário
export const MAX_DM_PARTICIPANTS = 10;
