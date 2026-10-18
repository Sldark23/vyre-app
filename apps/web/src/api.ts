// Cliente HTTP da API Vyre com refresh automático de token
const AUTH_KEY = 'vyre-auth';

export interface StoredAuth {
  user: { id: string; email: string; createdAt: string } & Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
}

export function getAuth(): StoredAuth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function setAuth(value: StoredAuth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(value));
}

export function patchAuth(patch: Partial<StoredAuth>) {
  const current = getAuth();
  if (!current) return;
  setAuth({ ...current, ...patch });
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  // dedupe: aba+WS podem disparar refresh ao mesmo tempo → uma chamada só
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const auth = getAuth();
    if (!auth?.refreshToken) return false;
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setAuth({ ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Renova os tokens se estiverem perto de expirar e devolve um access token válido. */
export async function getValidToken(): Promise<string | null> {
  const auth = getAuth();
  if (!auth?.accessToken) return null;
  const exp = jwtExp(auth.accessToken);
  // renova 60s antes do vencimento (JWT de 15 min)
  if (exp && exp * 1000 - Date.now() < 60_000) {
    if (await refresh()) return getAuth()?.accessToken ?? null;
  }
  return auth.accessToken;
}

/** Renova os tokens à força (usado quando o servidor recusa o access token). */
export async function refreshSession(): Promise<boolean> {
  return refresh();
}

function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; allowRetry?: boolean } = {},
): Promise<T> {
  const auth = getAuth();
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && auth?.refreshToken && options.allowRetry !== false) {
    if (await refresh()) {
      return request<T>(path, { ...options, allowRetry: false });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Erro de conexão');
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T,>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Upload de imagem (PNG/JPEG/GIF/WebP, 8MB) → { url } pública */
export async function uploadFile(file: File): Promise<{ url: string }> {
  const auth = getAuth();
  const form = new FormData();
  form.append('file', file);
  const doUpload = () =>
    fetch('/api/v1/uploads', {
      method: 'POST',
      headers: auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {},
      body: form,
    });
  let res = await doUpload();
  if (res.status === 401 && auth?.refreshToken && (await refresh())) {
    res = await doUpload();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'Falha no upload');
  }
  return data as { url: string };
}
