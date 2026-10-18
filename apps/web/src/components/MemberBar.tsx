import { useStore } from '../store';

export default function MemberBar() {
  const currentClusterId = useStore((s) => s.currentClusterId);
  const details = useStore((s) => (currentClusterId ? s.details[currentClusterId] : undefined));
  const openProfile = useStore((s) => s.openProfile);
  const members = details?.members ?? [];

  const online = members.filter((m) => m.user.status !== 'offline');
  const offline = members.filter((m) => m.user.status === 'offline');

  const renderMember = (m: (typeof members)[number]) => (
    <button
      key={m.user.id}
      className={`member ${m.user.status === 'offline' ? 'is-offline' : ''}`}
      onClick={() => openProfile(m.user.username)}
      title={`@${m.user.username}${m.user.customStatus ? ` — ${m.user.customStatus}` : ''}`}
    >
      <div className="avatar sm" style={{ background: m.user.bannerColor }}>
        {m.user.displayName.slice(0, 1).toUpperCase()}
        <div className={`dot ${m.user.status} in-avatar`} />
      </div>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {m.nickname ?? m.user.displayName}
      </span>
    </button>
  );

  return (
    <aside className="members">
      <div className="category">Em linha — {online.length}</div>
      {online.map(renderMember)}
      {offline.length > 0 && <div className="category">Offline — {offline.length}</div>}
      {offline.map(renderMember)}
      {members.length === 0 && (
        <div style={{ padding: 8, fontSize: 13, color: 'var(--text-2)' }}>
          Nenhum membro carregado ainda.
        </div>
      )}
    </aside>
  );
}
