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

async function refresh(): Promise<boolean> {
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
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; allowRetry?: boolean } = {},
): Promise<T> {
  const auth = getAuth();
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
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
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};
