import type { ServerEvent } from '@vyre/shared';

let socket: WebSocket | null = null;
let retryDelay = 1000;
let currentToken: string | null = null;
let onEventCallback: ((e: ServerEvent) => void) | null = null;
const subscribedChannels = new Set<string>();
let reconnectTimer: number | null = null;

function sendSubscriptions() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const channel of subscribedChannels) {
    socket.send(JSON.stringify({ type: 'subscribe', channel }));
  }
}

function open(token: string, onEvent: (e: ServerEvent) => void) {
  currentToken = token;
  onEventCallback = onEvent;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    retryDelay = 1000;
    sendSubscriptions();
    window.dispatchEvent(new CustomEvent('vyre:ws', { detail: { connected: true } }));
  };
  ws.onmessage = (raw) => {
    try {
      const event = JSON.parse(raw.data) as ServerEvent;
      onEventCallback?.(event);
    } catch {
      /* ignora */
    }
  };
  ws.onclose = () => {
    socket = null;
    window.dispatchEvent(new CustomEvent('vyre:ws', { detail: { connected: false } }));
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      if (currentToken) open(currentToken, onEventCallback!);
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15_000);
  };
  ws.onerror = () => ws.close();
}

export function connectWs(token: string, onEvent: (e: ServerEvent) => void) {
  if (socket) {
    socket.close();
    socket = null;
  }
  open(token, onEvent);
}

export function disconnectWs() {
  currentToken = null;
  onEventCallback = null;
  subscribedChannels.clear();
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

export function subscribeChannel(channelId: string) {
  subscribedChannels.add(channelId);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', channel: channelId }));
  }
}

export function sendTyping(channelId: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'typing', channel: channelId }));
  }
}
