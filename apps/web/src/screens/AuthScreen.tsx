import { useState } from 'react';
import { useStore } from '../store';
import { ApiError } from '../api';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(identifier, password);
      } else {
        await register({ username: username.toLowerCase(), email, password });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">Vyre</div>
        <div className="auth-sub">sua comunidade, seu jeito</div>

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Entrar
          </button>
          <button
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Criar conta
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'login' ? (
            <div className="field">
              <label>Email ou usuário</label>
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="voce@email.com"
                autoFocus
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>Usuário</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="seu.usuario"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@email.com"
                />
              </div>
            </>
          )}
          <div className="field">
            <label>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'mínimo 8 caracteres' : '••••••••'}
            />
          </div>
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Carregando…' : mode === 'login' ? 'Entrar' : 'Criar minha conta'}
          </button>
        </form>
      </div>
    </div>
  );
}
