import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import {
  generateRefreshToken,
  hashPassword,
  hashToken,
  REFRESH_TTL_DAYS,
  signAccessToken,
  verifyPassword,
} from '../lib/auth';
import { toPublicUser } from '../lib/serialize';
import { rateLimit } from '../lib/rateLimit';
import type { CurrentUser } from '@vyre/shared';

export function requireAuth(request: FastifyRequest): string {
  const userId = (request as unknown as { userId?: string }).userId;
  if (!userId) {
    const err = new Error('Não autenticado') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return userId;
}

async function issueTokens(userId: string) {
  const refreshToken = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, hashToken(refreshToken), String(REFRESH_TTL_DAYS)],
  );
  return { accessToken: signAccessToken(userId), refreshToken, expiresIn: 900 };
}

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_.]+$/, 'Só letras minúsculas, números, _ e .'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(64).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(3), // email ou username
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    if (!rateLimit(`register:${request.ip}`, 10)) {
      return reply.code(429).send({ error: 'Muitas tentativas, tente em instantes' });
    }
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' });
    }
    const { username, email, password, displayName } = parsed.data;
    const passwordHash = await hashPassword(password);
    try {
      const result = await query(
        `INSERT INTO users (username, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [username, email, passwordHash, displayName ?? username],
      );
      const user = result.rows[0];
      const tokens = await issueTokens(user.id);
      return reply.code(201).send({ user: toCurrentUser(user), ...tokens });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        const constraint = (err as { constraint?: string }).constraint ?? '';
        if (constraint.includes('username')) return reply.code(409).send({ error: 'Nome de usuário já existe' });
        if (constraint.includes('email')) return reply.code(409).send({ error: 'Email já cadastrado' });
      }
      throw err;
    }
  });

  app.post('/login', async (request, reply) => {
    if (!rateLimit(`login:${request.ip}`, 15)) {
      return reply.code(429).send({ error: 'Muitas tentativas, tente em instantes' });
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const { identifier, password } = parsed.data;
    const result = await query(`SELECT * FROM users WHERE email = $1 OR username = $1 LIMIT 1`, [
      identifier,
    ]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Credenciais inválidas' });
    }
    const tokens = await issueTokens(user.id);
    return reply.send({ user: toCurrentUser(user), ...tokens });
  });

  app.post('/refresh', async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const tokenHash = hashToken(body.data.refreshToken);
    const result = await query(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [
      tokenHash,
    ]);
    const row = result.rows[0];
    if (!row) return reply.code(401).send({ error: 'Refresh token inválido' });
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return reply.code(401).send({ error: 'Refresh token expirado' });
    }
    if (row.revoked_at) {
      // janela de graça de 60s: outra aba/sessão pode ter rotacionado o mesmo
      // token no mesmo instante (204/WS renovando em paralelo) — dentro da
      // janela emite um par novo independente; fora dela, reuso = revogado.
      const graceMs = 60_000;
      if (Date.now() - new Date(row.revoked_at).getTime() > graceMs) {
        return reply.code(401).send({ error: 'Refresh token revogado' });
      }
      const tokens = await issueTokens(row.user_id);
      return reply.send(tokens);
    }
    await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
    const tokens = await issueTokens(row.user_id);
    return reply.send(tokens);
  });

  app.post('/logout', async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(1) }).safeParse(request.body);
    if (body.success) {
      await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [
        hashToken(body.data.refreshToken),
      ]);
    }
    return reply.send({ ok: true });
  });

  app.get('/me', async (request, reply) => {
    const userId = requireAuth(request);
    const result = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
    const user = result.rows[0];
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });
    return reply.send({ user: toCurrentUser(user) });
  });
}

function toCurrentUser(row: Record<string, unknown>): CurrentUser {
  const pub = toPublicUser(row);
  return { ...pub, email: row.email as string, createdAt: row.created_at as string };
}
