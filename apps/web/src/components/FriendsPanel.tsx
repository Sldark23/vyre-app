import { useState } from 'react';
import { useStore } from '../store';
import { ApiError } from '../api';
import type { FriendsTab } from '../store';

function FriendRow({
  name,
  username,
  color,
  status,
  subtitle,
  children,
  onClick,
}: {
  name: string;
  username: string;
  color: string;
  status: string;
  subtitle?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const openProfile = useStore((s) => s.openProfile);
  return (
    <div className="friend-row">
      <button className="friend-main" onClick={onClick ?? (() => openProfile(username))}>
        <div className="avatar" style={{ background: color }}>
          {name.slice(0, 1).toUpperCase()}
          <div className={`dot ${status} in-avatar`} />
        </div>
        <div className="friend-info">
          <div className="friend-name">{name}</div>
          <div className="friend-sub">{subtitle ?? `@${username}`}</div>
        </div>
      </button>
      <div className="friend-actions">{children}</div>
    </div>
  );
}

export default function FriendsPanel() {
  const [tab, setTab] = useState<FriendsTab>('online');
  const friends = useStore((s) => s.friends);
  const incoming = useStore((s) => s.incoming);
  const outgoing = useStore((s) => s.outgoing);
  const acceptFriendRequest = useStore((s) => s.acceptFriendRequest);
  const declineFriendRequest = useStore((s) => s.declineFriendRequest);
  const removeFriend = useStore((s) => s.removeFriend);
  const sendFriendRequest = useStore((s) => s.sendFriendRequest);
  const openDm = useStore((s) => s.openDm);

  const [addName, setAddName] = useState('');
  const [addMsg, setAddMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const online = friends.filter((f) => f.user.status !== 'offline');
  const shown = tab === 'online' ? online : friends;
  const pendingCount = incoming.length;

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim().replace(/^@/, '');
    if (!name) return;
    setAdding(true);
    setAddMsg(null);
    try {
      const result = await sendFriendRequest(name);
      setAddMsg(
        result === 'accepted'
          ? { kind: 'ok', text: `Vocês já pediam amizade — agora são amigos de @${name}!` }
          : { kind: 'ok', text: `Pedido de amizade enviado pra @${name}` },
      );
      setAddName('');
    } catch (err) {
      setAddMsg({ kind: 'err', text: err instanceof ApiError ? err.message : 'Falha no pedido' });
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="chat">
      <div className="chat-header">
        <span className="title">👥 Amigos</span>
        <div className="tabs">
          {(
            [
              ['online', `Online${online.length ? ` — ${online.length}` : ''}`],
              ['all', `Todos — ${friends.length}`],
              ['pending', `Pendentes${pendingCount ? ` — ${pendingCount}` : ''}`],
            ] as [FriendsTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          <button className="tab add-friend-tab" onClick={() => setTab('add')}>
            + Adicionar amigo
          </button>
        </div>
      </div>

      <div className="friends-body">
        {tab === 'add' ? (
          <form className="add-friend" onSubmit={submitAdd}>
            <label>Adicionar amigo</label>
            <p>Você pode adicionar alguém pelo username do Vyre.</p>
            <div className="add-row">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="username"
                maxLength={64}
                autoFocus
              />
              <button className="btn-solid" disabled={adding || !addName.trim()}>
                {adding ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
            {addMsg && (
              <div className={`hint ${addMsg.kind === 'ok' ? 'ok' : 'err'}`}>{addMsg.text}</div>
            )}
          </form>
        ) : tab === 'pending' ? (
          <div className="friends-list-wrap">
            <div className="list-label">Pendentes — {incoming.length}</div>
            {incoming.length === 0 && (
              <div className="empty-line">Nenhum pedido recebido.</div>
            )}
            {incoming.map((r) => (
              <FriendRow
                key={r.id}
                name={r.user.displayName}
                username={r.user.username}
                color={r.user.bannerColor}
                status={r.user.status}
                subtitle={`quer ser seu amigo`}
              >
                <button className="btn-solid sm" onClick={() => acceptFriendRequest(r.id)}>
                  Aceitar
                </button>
                <button className="btn-ghost sm danger" onClick={() => declineFriendRequest(r.id)}>
                  Recusar
                </button>
              </FriendRow>
            ))}
            <div className="list-label" style={{ marginTop: 16 }}>
              Enviados — {outgoing.length}
            </div>
            {outgoing.length === 0 && (
              <div className="empty-line">Nenhum pedido enviado.</div>
            )}
            {outgoing.map((r) => (
              <FriendRow
                key={r.id}
                name={r.user.displayName}
                username={r.user.username}
                color={r.user.bannerColor}
                status={r.user.status}
                subtitle={`aguardando resposta`}
              >
                <button className="btn-ghost sm" onClick={() => declineFriendRequest(r.id)}>
                  Cancelar
                </button>
              </FriendRow>
            ))}
          </div>
        ) : (
          <div className="friends-list-wrap">
            <div className="list-label">
              {tab === 'online' ? 'Em linha agora' : 'Todos os amigos'} — {shown.length}
            </div>
            {shown.length === 0 && (
              <div className="empty-line">
                {tab === 'online'
                  ? 'Ninguém em linha agora.'
                  : 'Você ainda não tem amigos. Adicione alguém!'}
              </div>
            )}
            {shown.map((f) => (
              <FriendRow
                key={f.user.id}
                name={f.user.displayName}
                username={f.user.username}
                color={f.user.bannerColor}
                status={f.user.status}
                subtitle={
                  f.user.status === 'offline'
                    ? 'offline'
                    : (f.user.customStatus ?? `@${f.user.username}`)
                }
              >
                <button className="btn-solid sm" onClick={() => openDm([f.user.id])}>
                  Mensagem
                </button>
                <button className="btn-ghost sm danger" onClick={() => removeFriend(f.user.id)}>
                  Desfazer
                </button>
              </FriendRow>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
