import { useStore } from '../store';

export default function MemberBar() {
  const currentClusterId = useStore((s) => s.currentClusterId);
  const details = useStore((s) => (currentClusterId ? s.details[currentClusterId] : undefined));
  const members = details?.members ?? [];

  return (
    <aside className="members">
      <div className="category">Membros — {members.length}</div>
      {members.map((m) => (
        <div key={m.user.id} className="member">
          <div className="avatar sm" style={{ background: m.user.bannerColor }}>
            {m.user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.nickname ?? m.user.displayName}
          </span>
          <div className={`dot ${m.user.status}`} />
        </div>
      ))}
      {members.length === 0 && (
        <div style={{ padding: 8, fontSize: 13, color: 'var(--text-2)' }}>
          Nenhum membro carregado ainda.
        </div>
      )}
    </aside>
  );
}
