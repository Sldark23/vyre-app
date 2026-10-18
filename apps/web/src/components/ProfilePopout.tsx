import { useEffect, useState } from 'react';
import type { PublicProfile } from '@vyre/shared';
import { api, ApiError } from '../api';
import { useStore } from '../store';

export default function ProfilePopout() {
  const username = useStore((s) => s.profileUsername);
  const closeProfile = useStore((s) => s.closeProfile);
  const me = useStore((s) => s.user);
  const incoming = useStore((s) => s.incoming);
  const openDm = useStore((s) => s.openDm);
  const sendFriendRequest = useStore((s) => s.sendFriendRequest);
  const acceptFriendRequest = useStore((s) => s.acceptFriendRequest);
  const removeFriend = useStore((s) => s.removeFriend);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    setProfile(null);
    setError(null);
    api
      .get<{ profile: PublicProfile }>(`/api/v1/users/${encodeURIComponent(username)}`)
      .then((d) => {
        if (alive) setProfile(d.profile);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Falha ao carregar perfil');
      });
    return () => {
      alive = false;
    };
  }, [username]);

  useEffect(() => {
    if (!username) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProfile();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [username, closeProfile]);

  if (!username) return null;

  const p = profile;
  const isMe = p && me && p.user.id === me.id;
  const pendingReq = incoming.find((r) => r.user.id === p?.user.id);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Ação falhou');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={closeProfile}>
      <div className="profile-card" onClick={(e) => e.stopPropagation()}>
        <div className="profile-banner" style={{ background: p?.user.bannerColor ?? 'var(--accent)' }}>
          <button className="profile-close" onClick={closeProfile}>
            ✕
          </button>
          <div className="profile-avatar" style={{ background: p?.user.bannerColor ?? 'var(--accent)' }}>
            {(p?.user.displayName ?? '?').slice(0, 1).toUpperCase()}
          </div>
        </div>

        {!p && !error && <div className="profile-loading">Carregando perfil…</div>}
        {error && <div className="profile-loading err">{error}</div>}

        {p && (
          <div className="profile-body">
            <div className="profile-name">{p.user.displayName}</div>
            <div className="profile-username">
              @{p.user.username}
              <span className={`dot inline ${p.user.status}`} />
            </div>
            {p.user.customStatus && <div className="profile-custom">“{p.user.customStatus}”</div>}

            <div className="profile-section">
              <div className="profile-label">Sobre mim</div>
              <div className="profile-bio">
                {p.bio || <span style={{ opacity: 0.5 }}>Sem bio ainda.</span>}
              </div>
            </div>

            <div className="profile-meta">
              <span>
                Membro desde{' '}
                {new Date(p.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              {p.sharedClusters > 0 && <span>· {p.sharedClusters} cluster(s) em comum</span>}
            </div>

            {!isMe && (
              <div className="profile-actions">
                {p.relationship === 'none' && (
                  <>
                    <button
                      className="btn-solid"
                      disabled={busy}
                      onClick={() => act(() => sendFriendRequest(p.user.username))}
                    >
                      Adicionar amigo
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        closeProfile();
                        void openDm([p.user.id]);
                      }}
                    >
                      Mensagem
                    </button>
                  </>
                )}
                {p.relationship === 'pending_out' && (
                  <span className="hint">Pedido de amizade enviado ✓</span>
                )}
                {p.relationship === 'pending_in' && (
                  <>
                    <button
                      className="btn-solid"
                      disabled={busy || !pendingReq}
                      onClick={() =>
                        pendingReq ? act(() => acceptFriendRequest(pendingReq.id)) : undefined
                      }
                    >
                      Aceitar pedido
                    </button>
                    <span className="hint">…recebido de @{p.user.username}</span>
                  </>
                )}
                {p.relationship === 'friends' && (
                  <>
                    <button
                      className="btn-solid"
                      onClick={() => {
                        closeProfile();
                        void openDm([p.user.id]);
                      }}
                    >
                      Mensagem
                    </button>
                    <button
                      className="btn-ghost danger"
                      disabled={busy}
                      onClick={() => act(() => removeFriend(p.user.id))}
                    >
                      Desfazer amizade
                    </button>
                  </>
                )}
              </div>
            )}
            {isMe && <div className="hint">Este é você! Edite seu perfil pelo menu ↑.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
