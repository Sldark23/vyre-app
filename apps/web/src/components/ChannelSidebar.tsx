import { useStore } from '../store';
import UserPanel from './UserPanel';

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
        {voiceChannels.map((ch) => (
          <div key={ch.id} className="channel-item" style={{ opacity: 0.5, cursor: 'default' }} title="Voz entra na fase 3">
            <span className="hash">{ICONS.voice}</span>
            <span>{ch.name}</span>
          </div>
        ))}
      </div>
      <UserPanel />
    </aside>
  );
}
