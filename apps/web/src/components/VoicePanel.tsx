import { useState } from 'react';
import { useStore } from '../store';
import { leaveVoice, toggleDeafen, toggleMic } from '../voice';
import {
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneHangupIcon,
  SpeakerIcon,
} from './Icons';

/* Painel fixo acima do UserPanel quando o usuário está numa sala de voz */
export default function VoicePanel() {
  const activeVoice = useStore((s) => s.activeVoice);
  const channels = useStore((s) => s.channels);
  const clusters = useStore((s) => s.clusters);
  const participants = useStore((s) =>
    activeVoice ? s.voiceParticipants[activeVoice.channelId] : undefined,
  );
  const speakingIds = useStore((s) => s.speakingIds);
  const muted = useStore((s) => s.voiceMuted);
  const deafened = useStore((s) => s.voiceDeafened);
  const error = useStore((s) => s.voiceError);
  const user = useStore((s) => s.user);
  const [leaving, setLeaving] = useState(false);

  if (!activeVoice) return null;
  const cluster = clusters.find((c) => c.id === activeVoice.clusterId);
  const channel = (channels[activeVoice.clusterId] ?? []).find(
    (c) => c.id === activeVoice.channelId,
  );
  const list = participants ?? [];
  const meInList = user && list.some((p) => p.userId === user.id);

  return (
    <div className="voice-panel">
      <div className="voice-panel-head">
        <span className="voice-panel-title">
          <span className="vpt-row">
            <SpeakerIcon size={15} /> {channel?.name ?? 'Canal de voz'}
          </span>
          {cluster && <span className="voice-panel-cluster">{cluster.name}</span>}
        </span>
        <span className="voice-live">● ao vivo</span>
      </div>

      <div className="voice-panel-list">
        {/* garante que eu apareça mesmo antes do webhook chegar */}
        {user && !meInList && (
          <div className="voice-participant speaking-pending">
            <div className="avatar xs" style={{ background: user.bannerColor }}>
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <span>{user.displayName} (você)</span>
          </div>
        )}
        {list.map((p) => (
          <div
            key={p.userId}
            className={`voice-participant ${speakingIds.includes(p.userId) ? 'speaking' : ''}`}
            title={speakingIds.includes(p.userId) ? 'Falando' : undefined}
          >
            <div className="avatar xs" style={{ background: 'var(--bg-3)' }}>
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" />
              ) : (
                p.displayName.slice(0, 1).toUpperCase()
              )}
            </div>
            <span>
              {p.displayName}
              {p.userId === user?.id && muted && <em className="voice-mute-tag"> (mudo)</em>}
            </span>
          </div>
        ))}
      </div>

      {error && <div className="voice-error">{error}</div>}

      <div className="voice-controls">
        <button
          className={`voice-btn ${muted ? 'off' : ''}`}
          onClick={() => void toggleMic()}
          title={muted ? 'Ligar microfone' : 'Desligar microfone'}
        >
          {muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
        </button>
        <button
          className={`voice-btn ${deafened ? 'off' : ''}`}
          onClick={toggleDeafen}
          title={deafened ? 'Reativar som' : 'Abafar som'}
        >
          {deafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
        </button>
        <button
          className="voice-btn disconnect"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            leaveVoice();
            setLeaving(false);
          }}
          title="Desconectar"
        >
          <PhoneHangupIcon size={18} />
        </button>
      </div>
    </div>
  );
}
