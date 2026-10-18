import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function loadFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const root = path.resolve(process.cwd(), '../..');
loadFile(path.join(root, '.env.db'));
loadFile(path.join(process.cwd(), '.env'));
loadFile(path.join(root, '.env'));

// Persiste um segredo JWT gerado pra não invalidar sessões a cada restart
let jwtSecret = process.env.VYRE_JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  const envFile = path.join(root, '.env');
  fs.appendFileSync(envFile, `VYRE_JWT_SECRET=${jwtSecret}\n`);
  try {
    fs.chmodSync(envFile, 0o600);
  } catch {}
  console.log('[env] VYRE_JWT_SECRET gerado e salvo em .env');
}

export const env = {
  port: Number(process.env.VYRE_PORT ?? 3100),
  dbUrl:
    process.env.VYRE_DB_URL ??
    `postgres://vyre:${process.env.VYRE_DB_PASSWORD ?? ''}@127.0.0.1:5433/vyre`,
  redisUrl: process.env.VYRE_REDIS_URL ?? 'redis://127.0.0.1:6379',
  // LiveKit (voz) — chaves espelhadas em /root/vyre-app/livekit/livekit.yaml
  livekitUrl: process.env.VYRE_LIVEKIT_URL ?? 'wss://voz.vyre.zeninhost.xyz',
  livekitKey: process.env.VYRE_LIVEKIT_KEY ?? '',
  livekitSecret: process.env.VYRE_LIVEKIT_SECRET ?? '',
  jwtSecret,
  serveWeb: process.env.VYRE_SERVE_WEB !== '0',
  corsOrigins: (process.env.VYRE_CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim()),
};
