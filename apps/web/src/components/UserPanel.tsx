import { useEffect, useRef, useState } from 'react';
import type { UserStatus } from '@vyre/shared';
import { useStore } from '../store';
import { ApiError } from '../api';

const STATUS_OPTIONS: { value: UserStatus; label: string; emoji: string }[] = [
  { value: 'online', label: 'Online', emoji: '🟢' },
  { value: 'idle', label: 'Ausente', emoji: '🌙' },
  { value: 'dnd', label: 'Ocupado', emoji: '⛔' },
  { value: 'invisible', label: 'Invisível', emoji: '👻' },
];

export default function UserPanel() {
  const user = useStore((s) => s.user);
  const setStatus = useStore((s) => s.setStatus);
  const updateProfile = useStore((s) => s.updateProfile);
  const openProfile = useStore((s) => s.openProfile);
  const logout = useStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;
  const status = user.status;

  async function saveCustom() {
    setSaving(true);
    try {
      await updateProfile({ customStatus: custom.trim() || null });
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="user-panel" ref={ref}>
      <button className="user-panel-btn" onClick={() => setOpen((v) => !v)}>
        <div className="avatar sm" style={{ background: user.bannerColor }}>
          {user.displayName.slice(0, 1).toUpperCase()}
          <div className={`dot ${status} in-avatar`} />
        </div>
        <div className="info">
          <div className="name">{user.displayName}</div>
          <div className="tag">
            {user.customStatus || `@${user.username}`}
          </div>
        </div>
        <span className="chev">⋯</span>
      </button>

      {open && (
        <div className="status-menu">
          <div className="status-menu-title">Definir status</div>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`status-opt ${status === opt.value ? 'active' : ''}`}
              onClick={() => {
                setStatus(opt.value);
              }}
            >
              <span>{opt.emoji}</span> {opt.label}
              {status === opt.value && <span className="check">✓</span>}
            </button>
          ))}
          <div className="status-sep" />
          <div className="status-menu-title">Status personalizado</div>
          <div className="status-custom">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="ex.: jogando algo"
              maxLength={64}
              onKeyDown={(e) => e.key === 'Enter' && saveCustom()}
            />
            <button onClick={saveCustom} disabled={saving}>
              OK
            </button>
          </div>
          <div className="status-sep" />
          <button
            className="status-opt"
            onClick={() => {
              setOpen(false);
              openProfile(user.username);
            }}
          >
            <span>👤</span> Ver meu perfil
          </button>
          <button
            className="status-opt danger"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <span>🚪</span> Sair
          </button>
        </div>
      )}
    </div>
  );
}
