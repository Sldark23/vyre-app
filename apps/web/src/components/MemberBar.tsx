import { useStore } from '../store';
import { CrownIcon, ShieldIcon, SparkleIcon, XIcon } from './Icons';

export default function MemberBar() {
  const currentClusterId = useStore((s) => s.currentClusterId);
  const details = useStore((s) => (currentClusterId ? s.details[currentClusterId] : undefined));
  const openProfile = useStore((s) => s.openProfile);
  const kickMember = useStore((s) => s.kickMember);
  const meId = useStore((s) => s.user?.id);
  const members = details?.members ?? [];
  const myRole = details?.myRole ?? null;
  const canKick = myRole === 'owner' || myRole === 'moderator';

  const online = members.filter((m) => m.user.status !== 'offline');
  const offline = members.filter((m) => m.user.status === 'offline');

  function kickable(m: (typeof members)[number]) {
    if (!canKick || !currentClusterId) return false;
    if (m.user.id === meId) return false;
    if (m.role === 'owner') return false;
    if (myRole === 'moderator' && m.role === 'moderator') return false;
    return true;
  }

  const renderMember = (m: (typeof members)[number]) => (
    <div
      key={m.user.id}
      className={`member ${m.user.status === 'offline' ? 'is-offline' : ''}`}
    >
      <button
        className="member-main"
        onClick={() => openProfile(m.user.username)}
        title={`@${m.user.username}${m.user.customStatus ? ` — ${m.user.customStatus}` : ''}`}
      >
        <div className="avatar sm" style={{ background: m.user.bannerColor }}>
          {m.user.avatarUrl ? (
            <img src={m.user.avatarUrl} alt="" />
          ) : (
            m.user.displayName.slice(0, 1).toUpperCase()
          )}
          <div className={`dot ${m.user.status} in-avatar`} />
        </div>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.nickname || m.user.displayName}
        </span>
        {m.user.plus && (
          <span className="plus-badge" title="Vyre+">
            <SparkleIcon size={12} />
          </span>
        )}
        {m.role === 'owner' && (
          <span className="role-badge owner" title="Dono">
            <CrownIcon size={13} />
          </span>
        )}
        {m.role === 'moderator' && (
          <span className="role-badge mod" title="Moderador">
            <ShieldIcon size={13} />
          </span>
        )}
      </button>
      {kickable(m) && currentClusterId && (
        <button
          className="member-kick"
          title={`Kickar @${m.user.username}`}
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Kickar @${m.user.username} do cluster?`)) {
              void kickMember(currentClusterId, m.user.id).catch(() => {});
            }
          }}
        >
          <XIcon size={13} />
        </button>
      )}
    </div>
  );

  return (
    <aside className="member-bar">
      {online.length > 0 && (
        <>
          <div className="member-cat">EM LINHA — {online.length}</div>
          {online.map(renderMember)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="member-cat">OFFLINE — {offline.length}</div>
          {offline.map(renderMember)}
        </>
      )}
      {members.length === 0 && (
        <div className="member-cat">Nenhum membro</div>
      )}
    </aside>
  );
}
