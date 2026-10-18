import { useStore } from '../store';
import FriendsPanel from './FriendsPanel';
import DMView from './DMView';
import UserPanel from './UserPanel';

function dmLabel(convId: string): string {
  const state = useStore.getState();
  const conv = state.dms.find((c) => c.id === convId);
  if (!conv) return 'Conversa';
  if (conv.isGroup) return conv.name ?? 'Grupo';
  return conv.participants.find((p) => p.id !== state.user?.id)?.displayName ?? 'Conversa';
}

export default function FriendsHome() {
  const dms = useStore((s) => s.dms);
  const currentDmId = useStore((s) => s.currentDmId);
  const dmUnread = useStore((s) => s.dmUnread);
  const incoming = useStore((s) => s.incoming);
  const selectDm = useStore((s) => s.selectDm);
  const me = useStore((s) => s.user);

  return (
    <>
      <aside className="sidebar home-sidebar">
        <div className="sidebar-header">Mensagens</div>
        <div className="channel-list">
          <button
            className={`channel-item dm-nav ${!currentDmId ? 'active' : ''}`}
            onClick={() => useStore.setState({ currentDmId: null, view: 'home' })}
          >
            <span className="hash">👥</span>
            <span>Amigos</span>
            {incoming.length > 0 && <span className="badge">{incoming.length}</span>}
          </button>

          <div className="channel-category">Conversas diretas</div>
          {dms.length === 0 && (
            <div style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-2)' }}>
              Nenhuma conversa ainda. Vá em <b>Amigos</b> e clique em Mensagem.
            </div>
          )}
          {dms.map((c) => (
            <button
              key={c.id}
              className={`channel-item dm-item ${currentDmId === c.id ? 'active' : ''}`}
              onClick={() => selectDm(c.id)}
            >
              <div
                className="avatar xs"
                style={{
                  background:
                    c.isGroup
                      ? 'var(--accent)'
                      : (c.participants.find((p) => p.id !== me?.id)?.bannerColor ?? 'var(--accent)'),
                }}
              >
                {c.isGroup
                  ? (c.name ?? 'G').slice(0, 1).toUpperCase()
                  : (c.participants.find((p) => p.id !== me?.id)?.displayName ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {dmLabel(c.id)}
              </span>
              {(dmUnread[c.id] ?? 0) > 0 && currentDmId !== c.id && (
                <span className="badge">{dmUnread[c.id]}</span>
              )}
            </button>
          ))}
        </div>
        <UserPanel />
      </aside>
      {currentDmId ? <DMView /> : <FriendsPanel />}
    </>
  );
}
