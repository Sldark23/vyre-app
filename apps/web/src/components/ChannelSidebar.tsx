import { useStore } from '../store';
import UserPanel from './UserPanel';
import VoicePanel from './VoicePanel';
import { joinVoice } from '../voice';

const ICONS: Record<string, string> = {
  text: '#',
  voice: '🔊',
  announcement: '📢',
  forum: '☰',
};

export default function ChannelSidebar() {
  const currentClusterId = useStore((s) => s.currentClusterId);
  const clusters = useStore((s) => s.clusters);
  const channels = useStore((s) => (currentClusterId ? s.channels[currentClusterId] : undefined));
  const currentChannelId = useStore((s) => s.currentChannelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const unread = useStore((s) => s.unread);
  const voiceParticipants = useStore((s) => s.voiceParticipants);
  const activeVoice = useStore((s) => s.activeVoice);
  const voiceLoading = useStore((s) => s.voiceLoading);

  const cluster = clusters.find((c) => c.id === currentClusterId);
  const textChannels = (channels ?? []).filter((c) => c.type !== 'voice');
  const voiceChannels = (channels ?? []).filter((c) => c.type === 'voice');

  return (
    <aside className="sidebar">
      <div className="sidebar-header" title={cluster?.description || cluster?.name}>
        {cluster?.name ?? 'Vyre'}
      </div>
      <div className="channel-list">
        {!cluster && (
          <div style={{ padding: 12, color: 'var(--text-2)', fontSize: 13 }}>
            Crie um cluster no rail ao lado ou entre com um convite.
          </div>
        )}
        {textChannels.length > 0 && <div className="channel-category">Canais de texto</div>}
        {textChannels.map((ch) => (
          <button
            key={ch.id}
            className={`channel-item ${currentChannelId === ch.id ? 'active' : ''}`}
            onClick={() => selectChannel(ch.id)}
          >
            <span className="hash">{ICONS[ch.type] ?? '#'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
            {(unread[ch.id] ?? 0) > 0 && currentChannelId !== ch.id && (
              <span className="badge">{unread[ch.id]}</span>
            )}
          </button>
        ))}
        {voiceChannels.length > 0 && <div className="channel-category">Canais de voz</div>}
        {voiceChannels.map((ch) => {
          const inThis = activeVoice?.channelId === ch.id;
          const people = voiceParticipants[ch.id] ?? [];
          return (
            <div key={ch.id} className="voice-channel-block">
              <button
                className={`channel-item ${inThis ? 'active voice-active' : ''}`}
                disabled={voiceLoading && !inThis}
                onClick={() => {
                  if (inThis) return; // já está aqui
                  void joinVoice(ch.id, ch.clusterId).catch(() => {});
                }}
                title={inThis ? 'Você está conectado' : 'Entrar no canal de voz'}
              >
                <span className="hash">{ICONS.voice}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</span>
                {people.length > 0 && <span className="voice-count">{people.length}</span>}
              </button>
              {people.length > 0 && (
                <div className="voice-channel-people">
                  {people.map((p) => (
                    <div key={p.userId} className="voice-channel-person">
                      <div className="avatar xs" style={{ background: 'var(--bg-3)' }}>
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" />
                        ) : (
                          p.displayName.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <span>{p.displayName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <VoicePanel />
      <UserPanel />
    </aside>
  );
}
