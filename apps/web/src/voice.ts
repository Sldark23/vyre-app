import type { Room as LivekitRoom } from 'livekit-client';
import { api } from './api';
import { useStore } from './store';

/* Gerencia a sala de voz do LiveKit (uma por vez).
 * O estado (quem está em cada canal) vive no store, alimentado pelos
 * webhooks do servidor via WS (voice:update) — aqui só cuidamos da mídia.
 * livekit-client é importado de forma dinâmica: só baixa na primeira
 * entrada em voz (o bundle principal fica leve). */

let room: LivekitRoom | null = null;
let audioBox: HTMLDivElement | null = null;

function getAudioBox(): HTMLDivElement {
  if (!audioBox) {
    audioBox = document.createElement('div');
    audioBox.id = 'vyre-voice-audio';
    audioBox.style.display = 'none';
    document.body.appendChild(audioBox);
  }
  return audioBox;
}

function remoteAudios(): HTMLAudioElement[] {
  return Array.from(getAudioBox().querySelectorAll('audio'));
}

function applyDeafen(deafened: boolean) {
  for (const el of remoteAudios()) el.muted = deafened;
}

export function isVoiceConnected(): boolean {
  return room !== null;
}

export async function joinVoice(channelId: string, clusterId: string): Promise<void> {
  const store = useStore.getState();
  store.setVoiceError(null);
  store.setVoiceLoading(true);
  try {
    if (room) leaveVoice();
    const [{ url, token }, { Room, RoomEvent, Track }] = await Promise.all([
      api.post<{ url: string; token: string }>('/api/v1/voice/token', { channelId }),
      import('livekit-client'),
    ]);

    const r = new Room({ adaptiveStream: true, disconnectOnPageLeave: true });

    r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      useStore.getState().setSpeaking(speakers.map((s) => s.identity));
    });
    r.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      el.muted = useStore.getState().voiceDeafened;
      getAudioBox().appendChild(el);
    });
    r.on(RoomEvent.TrackUnsubscribed, (track) => {
      for (const el of track.detach()) el.remove();
    });
    r.on(RoomEvent.Reconnecting, () => {
      useStore.getState().setVoiceError('Reconectando à voz…');
    });
    r.on(RoomEvent.Reconnected, () => {
      useStore.getState().setVoiceError(null);
    });
    r.on(RoomEvent.Disconnected, () => {
      if (room !== r) return; // já trocamos de sala
      room = null;
      getAudioBox().innerHTML = '';
      const s = useStore.getState();
      s.setActiveVoice(null);
      s.setVoiceError(null);
    });

    room = r;
    await r.connect(url, token);
    await r.localParticipant.setMicrophoneEnabled(true);
    useStore.getState().setVoiceMuted(false);
    useStore.getState().setVoiceDeafened(false);
    useStore.getState().setActiveVoice({ channelId, clusterId });
  } catch (err) {
    if (room) {
      room.disconnect();
      room = null;
    }
    useStore.getState().setActiveVoice(null);
    useStore.getState().setVoiceError(
      err instanceof Error ? `Não foi possível conectar à voz: ${err.message}` : 'Falha na voz',
    );
    throw err;
  } finally {
    useStore.getState().setVoiceLoading(false);
  }
}

export function leaveVoice(): void {
  if (!room) return;
  const r = room;
  room = null;
  r.disconnect();
  getAudioBox().innerHTML = '';
  const s = useStore.getState();
  s.setActiveVoice(null);
  s.setVoiceError(null);
}

export async function toggleMic(): Promise<void> {
  const store = useStore.getState();
  if (!room) return;
  const { Track } = await import('livekit-client');
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  if (pub) {
    // já tem mic publicado: mute/unmute sem republicar
    if (store.voiceMuted) await pub.unmute();
    else await pub.mute();
    store.setVoiceMuted(!store.voiceMuted);
  } else {
    await room.localParticipant.setMicrophoneEnabled(true);
    store.setVoiceMuted(false);
  }
}

export function toggleDeafen(): void {
  const store = useStore.getState();
  if (!room) return;
  const next = !store.voiceDeafened;
  applyDeafen(next);
  store.setVoiceDeafened(next);
  if (next && !store.voiceMuted) {
    // abafar também silencia o micro (igual Discord)
    void toggleMic();
  }
}
