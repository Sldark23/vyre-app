import { useState } from 'react';
import { useStore } from '../store';
import { ApiError } from '../api';

export default function Modals({ kind, onClose }: { kind: 'create' | 'join'; onClose: () => void }) {
  const createCluster = useStore((s) => s.createCluster);
  const joinCluster = useStore((s) => s.joinCluster);
  const logout = useStore((s) => s.logout);
  const user = useStore((s) => s.user);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (kind === 'create') await createCluster(name, description || undefined);
      else await joinCluster(code.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha de conexão');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{kind === 'create' ? 'Criar cluster' : 'Entrar com convite'}</h2>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit}>
          {kind === 'create' ? (
            <>
              <div className="field">
                <label>Nome do cluster</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Squad do Fulano"
                  autoFocus
                  maxLength={100}
                />
              </div>
              <div className="field">
                <label>Descrição (opcional)</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="O que é este cluster?"
                  maxLength={500}
                />
              </div>
            </>
          ) : (
            <div className="field">
              <label>Código de convite</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="cole o código aqui"
                autoFocus
              />
            </div>
          )}
          <div className="row">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-solid" disabled={loading || (kind === 'create' ? !name.trim() : !code.trim())}>
              {kind === 'create' ? 'Criar' : 'Entrar'}
            </button>
          </div>
        </form>
        <div className="row" style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {user?.displayName} · @{user?.username}
          </span>
          <button className="btn-ghost" style={{ color: 'var(--danger)' }} onClick={logout}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
