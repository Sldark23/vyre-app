import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Channel,
  Cluster,
  ClusterMember,
  CurrentUser,
  DMConversation,
  DisplayStatus,
  FriendEntry,
  FriendRequestEntry,
  Message,
  PublicUser,
  ServerEvent,
  UserStatus,
} from '@vyre/shared';
import { api, clearAuth, getAuth, patchAuth, setAuth } from './api';
import {
  connectWs,
  disconnectWs,
  sendPresence,
  subscribeChannel,
  subscribeCluster,
  subscribeDm,
} from './ws';

export interface ClusterWithChannel extends Cluster {
  firstChannelId: string | null;
}

export type View = 'cluster' | 'home';
export type FriendsTab = 'online' | 'all' | 'pending' | 'add';

interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

interface ProfilePatch {
  displayName?: string;
  bio?: string;
  bannerColor?: string;
  avatarUrl?: string | null;
  customStatus?: string | null;
}

interface AppState {
  // auth (persistido)
  user: CurrentUser | null;
  accessToken: string | null;
  refreshToken: string | null;

  // navegação
  view: View;
  clusters: ClusterWithChannel[];
  currentClusterId: string | null;
  currentChannelId: string | null;
  channels: Record<string, Channel[]>;
  details: Record<string, { members: ClusterMember[]; isOwner: boolean }>;
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  wsConnected: boolean;

  // Fase 2: amigos, DMs, perfil
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  dms: DMConversation[];
  currentDmId: string | null;
  dmMessages: Record<string, Message[]>;
  dmUnread: Record<string, number>;
  dmTyping: Record<string, string[]>;
  profileUsername: string | null;

  // ações
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  setView: (view: View) => void;
  loadClusters: () => Promise<void>;
  createCluster: (name: string, description?: string) => Promise<void>;
  joinCluster: (code: string) => Promise<void>;
  selectCluster: (clusterId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMessages: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyTo?: string) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  setWsConnected: (connected: boolean) => void;
  handleWsEvent: (event: ServerEvent) => void;

  // amigos
  loadFriends: () => Promise<void>;
  sendFriendRequest: (username: string) => Promise<'sent' | 'accepted'>;
  acceptFriendRequest: (id: string) => Promise<void>;
  declineFriendRequest: (id: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;

  // DMs
  loadDms: () => Promise<void>;
  openDm: (userIds: string[], name?: string) => Promise<void>;
  selectDm: (conversationId: string) => Promise<void>;
  loadDmMessages: (conversationId: string) => Promise<void>;
  sendDmMessage: (conversationId: string, content: string) => Promise<void>;
  editDmMessage: (messageId: string, content: string) => Promise<void>;
  deleteDmMessage: (messageId: string) => Promise<void>;

  // perfil/presença
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  setStatus: (status: UserStatus) => void;
  openProfile: (username: string) => void;
  closeProfile: () => void;
}

async function authPost(
  path: string,
  body: unknown,
): Promise<{ user: CurrentUser; accessToken: string; refreshToken: string }> {
  return api.post(path, body);
}

function saveSession(data: { user: CurrentUser; accessToken: string; refreshToken: string }) {
  setAuth({
    user: data.user as unknown as StoredAuthLike,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
}

type StoredAuthLike = StoredAuthUser & Record<string, unknown>;
interface StoredAuthUser {
  id: string;
  email: string;
  createdAt: string;
}

// timers de "digitando" nas DMs (userId → timeout)
const dmTypingTimers = new Map<string, number>();

/** Espalha um status novo pra amigos, participantes de DM e membros de cluster */
function presenceInState(
  state: AppState,
  userId: string,
  status: DisplayStatus,
): Partial<AppState> {
  const details: AppState['details'] = {};
  for (const [cid, d] of Object.entries(state.details)) {
    details[cid] = {
      ...d,
      members: d.members.map((m) =>
        m.user.id === userId ? { ...m, user: { ...m.user, status } } : m,
      ),
    };
  }
  return {
    details,
    friends: state.friends.map((f) =>
      f.user.id === userId ? { ...f, user: { ...f.user, status } } : f,
    ),
    dms: state.dms.map((c) => ({
      ...c,
      participants: c.participants.map((p) =>
        p.id === userId ? { ...p, status } : p,
      ),
    })),
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      view: 'cluster',
      clusters: [],
      currentClusterId: null,
      currentChannelId: null,
      channels: {},
      details: {},
      messages: {},
      unread: {},
      wsConnected: false,
      friends: [],
      incoming: [],
      outgoing: [],
      dms: [],
      currentDmId: null,
      dmMessages: {},
      dmUnread: {},
      dmTyping: {},
      profileUsername: null,

      async login(identifier, password) {
        const data = await authPost('/api/v1/auth/login', { identifier, password });
        saveSession(data);
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        get().loadClusters();
        get().loadFriends().catch(() => {});
        get().loadDms().catch(() => {});
        connectWs(data.accessToken, get().handleWsEvent);
      },

      async register(payload) {
        const data = await authPost('/api/v1/auth/register', payload);
        saveSession(data);
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        get().loadClusters();
        connectWs(data.accessToken, get().handleWsEvent);
      },

      logout() {
        const auth = getAuth();
        if (auth?.refreshToken) {
          api.post('/api/v1/auth/logout', { refreshToken: auth.refreshToken }).catch(() => {});
        }
        clearAuth();
        disconnectWs();
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          view: 'cluster',
          clusters: [],
          currentClusterId: null,
          currentChannelId: null,
          channels: {},
          details: {},
          messages: {},
          unread: {},
          friends: [],
          incoming: [],
          outgoing: [],
          dms: [],
          currentDmId: null,
          dmMessages: {},
          dmUnread: {},
          dmTyping: {},
          profileUsername: null,
        });
      },

      setView(view) {
        set({ view });
        if (view === 'home') {
          get().loadFriends().catch(() => {});
          get().loadDms().catch(() => {});
        }
      },

      async loadClusters() {
        const data = await api.get<{ clusters: ClusterWithChannel[] }>('/api/v1/clusters');
        set({ clusters: data.clusters });
        const { currentClusterId } = get();
        if (!currentClusterId && data.clusters.length > 0) {
          const first = data.clusters[0];
          await get().selectCluster(first.id);
        }
      },

      async createCluster(name, description) {
        await api.post('/api/v1/clusters', { name, description });
        await get().loadClusters();
      },

      async joinCluster(code) {
        await api.post('/api/v1/clusters/join', { code });
        set({ currentClusterId: null });
        await get().loadClusters();
      },

      async selectCluster(clusterId) {
        set({ view: 'cluster', currentClusterId: clusterId });
        subscribeCluster(clusterId);
        const detail = await api.get<{
          cluster: Cluster;
          channels: Channel[];
          members: ClusterMember[];
          isOwner: boolean;
        }>(`/api/v1/clusters/${clusterId}`);
        set((s) => ({
          channels: { ...s.channels, [clusterId]: detail.channels },
          details: {
            ...s.details,
            [clusterId]: { members: detail.members, isOwner: detail.isOwner },
          },
          currentChannelId: detail.channels.find((c) => c.type === 'text')?.id ?? detail.channels[0]?.id ?? null,
        }));
        const channelId = get().currentChannelId;
        if (channelId) await get().loadMessages(channelId);
      },

      async selectChannel(channelId) {
        set({ currentChannelId: channelId });
        set((s) => ({ unread: { ...s.unread, [channelId]: 0 } }));
        subscribeChannel(channelId);
        if (!get().messages[channelId]) {
          await get().loadMessages(channelId);
        }
      },

      async loadMessages(channelId) {
        const data = await api.get<{ messages: Message[] }>(
          `/api/v1/channels/${channelId}/messages?limit=50`,
        );
        set((s) => ({ messages: { ...s.messages, [channelId]: data.messages } }));
        subscribeChannel(channelId);
      },

      async sendMessage(channelId, content, replyTo) {
        const data = await api.post<{ message: Message }>(`/api/v1/channels/${channelId}/messages`, {
          content,
          replyTo,
        });
        // o evento WS também chega, então só adiciona se ainda não existir
        set((s) => {
          const list = s.messages[channelId] ?? [];
          if (list.some((m) => m.id === data.message.id)) return s;
          return { messages: { ...s.messages, [channelId]: [...list, data.message] } };
        });
      },

      async editMessage(messageId, content) {
        await api.patch(`/api/v1/messages/${messageId}`, { content });
      },

      async deleteMessage(messageId) {
        await api.del(`/api/v1/messages/${messageId}`);
      },

      setWsConnected(connected) {
        set({ wsConnected: connected });
      },

      // ---------- Amigos ----------

      async loadFriends() {
        const data = await api.get<{
          friends: FriendEntry[];
          incoming: FriendRequestEntry[];
          outgoing: FriendRequestEntry[];
        }>('/api/v1/friends');
        set({ friends: data.friends, incoming: data.incoming, outgoing: data.outgoing });
      },

      async sendFriendRequest(username) {
        const res = await api.post<{ accepted?: boolean }>('/api/v1/friends/requests', {
          username,
        });
        await get().loadFriends();
        return res.accepted ? 'accepted' : 'sent';
      },

      async acceptFriendRequest(id) {
        await api.post(`/api/v1/friends/requests/${id}/accept`);
        await get().loadFriends();
      },

      async declineFriendRequest(id) {
        await api.post(`/api/v1/friends/requests/${id}/decline`);
        await get().loadFriends();
      },

      async removeFriend(userId) {
        await api.del(`/api/v1/friends/${userId}`);
        await get().loadFriends();
      },

      // ---------- DMs ----------

      async loadDms() {
        const data = await api.get<{ conversations: DMConversation[] }>('/api/v1/dms');
        set({ dms: data.conversations });
      },

      async openDm(userIds, name) {
        const data = await api.post<{ conversation: DMConversation }>('/api/v1/dms', {
          userIds,
          name,
        });
        const conv = data.conversation;
        set((s) => {
          const rest = s.dms.filter((c) => c.id !== conv.id);
          return {
            view: 'home',
            currentDmId: conv.id,
            dms: [conv, ...rest],
            profileUsername: null,
          };
        });
        await get().selectDm(conv.id);
      },

      async selectDm(conversationId) {
        set((s) => ({
          view: 'home',
          currentDmId: conversationId,
          dmUnread: { ...s.dmUnread, [conversationId]: 0 },
          profileUsername: null,
        }));
        subscribeDm(conversationId);
        if (!get().dmMessages[conversationId]) {
          await get().loadDmMessages(conversationId);
        }
      },

      async loadDmMessages(conversationId) {
        const data = await api.get<{ messages: Message[] }>(
          `/api/v1/dms/${conversationId}/messages?limit=50`,
        );
        set((s) => ({ dmMessages: { ...s.dmMessages, [conversationId]: data.messages } }));
        subscribeDm(conversationId);
      },

      async sendDmMessage(conversationId, content) {
        const data = await api.post<{ message: Message }>(
          `/api/v1/dms/${conversationId}/messages`,
          { content },
        );
        set((s) => {
          const list = s.dmMessages[conversationId] ?? [];
          if (list.some((m) => m.id === data.message.id)) return s;
          return {
            dmMessages: { ...s.dmMessages, [conversationId]: [...list, data.message] },
            dms: s.dms.map((c) =>
              c.id === conversationId ? { ...c, lastMessage: data.message } : c,
            ),
          };
        });
      },

      async editDmMessage(messageId, content) {
        await api.patch(`/api/v1/dm-messages/${messageId}`, { content });
      },

      async deleteDmMessage(messageId) {
        await api.del(`/api/v1/dm-messages/${messageId}`);
      },

      // ---------- Perfil e presença ----------

      async updateProfile(patch) {
        const data = await api.patch<{ user: CurrentUser }>('/api/v1/users/me', patch);
        set({ user: data.user });
      },

      setStatus(status) {
        // otimista: mostra na hora, o WS espalha pros outros
        set((s) => (s.user ? { user: { ...s.user, status } } : s));
        sendPresence(status);
      },

      openProfile(username) {
        set({ profileUsername: username });
      },

      closeProfile() {
        set({ profileUsername: null });
      },

      // ---------- Eventos WS ----------

      handleWsEvent(event) {
        const state = get();
        if (event.type === 'message:created') {
          const channelId = event.message.channelId;
          const list = state.messages[channelId] ?? [];
          if (list.some((m) => m.id === event.message.id)) return;
          const isActive = state.currentChannelId === channelId;
          set((s) => ({
            messages: { ...s.messages, [channelId]: [...list, event.message] },
            unread: isActive
              ? s.unread
              : { ...s.unread, [channelId]: (s.unread[channelId] ?? 0) + 1 },
          }));
        } else if (event.type === 'message:edited') {
          const channelId = event.message.channelId;
          set((s) => ({
            messages: {
              ...s.messages,
              [channelId]: (s.messages[channelId] ?? []).map((m) =>
                m.id === event.message.id ? event.message : m,
              ),
            },
          }));
        } else if (event.type === 'message:deleted') {
          set((s) => ({
            messages: {
              ...s.messages,
              [event.channelId]: (s.messages[event.channelId] ?? []).filter(
                (m) => m.id !== event.id,
              ),
            },
          }));
        } else if (event.type === 'presence:update') {
          set((s) => presenceInState(s, event.userId, event.status));
        } else if (event.type === 'friend:request') {
          void get().loadFriends();
        } else if (event.type === 'friend:accepted') {
          void get().loadFriends();
        } else if (event.type === 'friend:removed') {
          void get().loadFriends();
        } else if (event.type === 'dm:created') {
          const conv = event.conversation;
          set((s) => {
            const exists = s.dms.some((c) => c.id === conv.id);
            return {
              dms: exists ? s.dms.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...s.dms],
            };
          });
        } else if (event.type === 'dm:message:created') {
          const { conversationId, message } = event;
          const list = state.dmMessages[conversationId] ?? [];
          if (list.some((m) => m.id === message.id)) return;
          const isActive = state.currentDmId === conversationId && state.view === 'home';
          set((s) => ({
            dmMessages: {
              ...s.dmMessages,
              [conversationId]: [...(s.dmMessages[conversationId] ?? []), message],
            },
            dms: s.dms.map((c) =>
              c.id === conversationId ? { ...c, lastMessage: message } : c,
            ),
            dmUnread: isActive
              ? s.dmUnread
              : { ...s.dmUnread, [conversationId]: (s.dmUnread[conversationId] ?? 0) + 1 },
          }));
        } else if (event.type === 'dm:message:edited') {
          const { conversationId, message } = event;
          set((s) => ({
            dmMessages: {
              ...s.dmMessages,
              [conversationId]: (s.dmMessages[conversationId] ?? []).map((m) =>
                m.id === message.id ? message : m,
              ),
            },
          }));
        } else if (event.type === 'dm:message:deleted') {
          const { conversationId, id } = event;
          set((s) => ({
            dmMessages: {
              ...s.dmMessages,
              [conversationId]: (s.dmMessages[conversationId] ?? []).filter(
                (m) => m.id !== id,
              ),
            },
          }));
        } else if (event.type === 'dm:typing') {
          const key = `${event.conversation}:${event.userId}`;
          set((s) => {
            const current = s.dmTyping[event.conversation] ?? [];
            if (current.includes(event.userId)) return s;
            return {
              dmTyping: { ...s.dmTyping, [event.conversation]: [...current, event.userId] },
            };
          });
          const old = dmTypingTimers.get(key);
          if (old) window.clearTimeout(old);
          dmTypingTimers.set(
            key,
            window.setTimeout(() => {
              set((s) => ({
                dmTyping: {
                  ...s.dmTyping,
                  [event.conversation]: (s.dmTyping[event.conversation] ?? []).filter(
                    (id) => id !== event.userId,
                  ),
                },
              }));
              dmTypingTimers.delete(key);
            }, 5000),
          );
        }
      },
    }),
    {
      name: 'vyre-auth',
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    },
  ),
);

// Reconecta o WS ao recarregar a página com sessão salva
export function bootstrapSession() {
  const auth = getAuth();
  if (auth?.accessToken && auth.user) {
    const store = useStore.getState();
    useStore.setState({
      user: auth.user as unknown as CurrentUser,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    connectWs(auth.accessToken, useStore.getState().handleWsEvent);
    store.loadClusters().catch(() => {});
    store.loadFriends().catch(() => {});
    store.loadDms().catch(() => {});
  }
}

// Sincroniza token renovado pelo refresh automático
export function syncTokensFromStorage() {
  const auth = getAuth();
  if (auth) patchAuth(auth);
}

// Helpers de UI p/ presence
export type { PublicUser };
