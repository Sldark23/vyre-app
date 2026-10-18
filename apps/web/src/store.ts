import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel, Cluster, ClusterMember, CurrentUser, Message, ServerEvent } from '@vyre/shared';
import { api, clearAuth, getAuth, patchAuth, setAuth } from './api';
import { connectWs, disconnectWs, subscribeChannel } from './ws';

export interface ClusterWithChannel extends Cluster {
  firstChannelId: string | null;
}

interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

interface AppState {
  // auth (persistido)
  user: CurrentUser | null;
  accessToken: string | null;
  refreshToken: string | null;

  // navegação
  clusters: ClusterWithChannel[];
  currentClusterId: string | null;
  currentChannelId: string | null;
  channels: Record<string, Channel[]>;
  details: Record<string, { members: ClusterMember[]; isOwner: boolean }>;
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  wsConnected: boolean;

  // ações
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
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

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      clusters: [],
      currentClusterId: null,
      currentChannelId: null,
      channels: {},
      details: {},
      messages: {},
      unread: {},
      wsConnected: false,

      async login(identifier, password) {
        const data = await authPost('/api/v1/auth/login', { identifier, password });
        saveSession(data);
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
        get().loadClusters();
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
          clusters: [],
          currentClusterId: null,
          currentChannelId: null,
          channels: {},
          details: {},
          messages: {},
          unread: {},
        });
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
        set({ currentClusterId: clusterId });
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
  }
}

// Sincroniza token renovado pelo refresh automático
export function syncTokensFromStorage() {
  const auth = getAuth();
  if (auth) patchAuth(auth);
}
