import { useEffect, useRef, useState } from 'react';
import type { UserStatus } from '@vyre/shared';
import { useStore } from '../store';
import { ApiError, uploadFile } from '../api';
import { ImageIcon, LogoutIcon, UserIcon } from './Icons';

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Ausente' },
  { value: 'dnd', label: 'Ocupado' },
  { value: 'invisible', label: 'Invisível' },
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
  const fileRef = useRef<HTMLInputElement>(null);

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
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" />
          ) : (
            user.displayName.slice(0, 1).toUpperCase()
          )}
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
              <span className={`dot inline ${opt.value}`} /> {opt.label}
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
          <button className="status-opt" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={15} /> Trocar avatar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setSaving(true);
              try {
                const { url } = await uploadFile(f);
                await updateProfile({ avatarUrl: url });
              } catch (err) {
                if (err instanceof ApiError) alert(err.message);
              } finally {
                setSaving(false);
              }
            }}
          />
          <button
            className="status-opt"
            onClick={() => {
              setOpen(false);
              openProfile(user.username);
            }}
          >
            <UserIcon size={15} /> Ver meu perfil
          </button>
          <button
            className="status-opt danger"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogoutIcon size={15} /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
