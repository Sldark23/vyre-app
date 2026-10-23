import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { clusterRoutes } from './routes/clusters';
import { channelRoutes } from './routes/channels';
import { friendRoutes } from './routes/friends';
import { dmRoutes } from './routes/dms';
import { voiceRoutes } from './routes/voice';
import { uploadRoutes } from './routes/uploads';
import { billingRoutes } from './routes/billing';
import { autoupdateRoutes } from './routes/autoupdate';
import { verifyAccessToken } from './lib/auth';
import { registerWs } from './ws';

const OPEN_ROUTES = [
  '/api/v1/health',
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/voice/webhook',
  '/api/v1/webhooks/mercadopago',
  '/api/v1/autoupdate/check',
  '/api/v1/autoupdate/test',
  '/api/v1/autoupdate/download/',
];

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.VYRE_LOG_LEVEL ?? 'info' },
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, { origin: env.corsOrigins });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  // JSON tolerando corpo vazio (DELETEs com Content-Type: application/json)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw) return done(null, undefined);
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Autenticação por JWT em toda rota /api exceto as abertas
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (OPEN_ROUTES.includes(url)) return;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const userId = token ? verifyAccessToken(token) : null;
    if (!userId) {
      return reply.code(401).send({ error: 'Não autenticado' });
    }
    (request as unknown as { userId: string }).userId = userId;
  });

  // Erros → JSON amigável
  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Erro interno' : err.message });
  });

  app.get('/api/v1/health', async () => ({
    ok: true,
    service: 'vyre-api',
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(clusterRoutes, { prefix: '/api/v1' });
  await app.register(channelRoutes, { prefix: '/api/v1' });
  await app.register(friendRoutes, { prefix: '/api/v1' });
  await app.register(dmRoutes, { prefix: '/api/v1' });
  await app.register(voiceRoutes, { prefix: '/api/v1' });
  await app.register(uploadRoutes, { prefix: '/api/v1' });
  await app.register(billingRoutes, { prefix: '/api/v1' });
  await app.register(autoupdateRoutes, { prefix: '/api/v1' });

  registerWs(app);

  // Serve uploads (imagens) — nomes aleatórios + cache imutável
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, {
    root: env.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
    immutable: true,
    maxAge: '365d',
  });

  // Serve o build da web (SPA) se existir
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, '../../../apps/web/dist');
  if (env.serveWeb && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Rota não encontrada' });
      }
      if (request.url.startsWith('/uploads')) {
        return reply.code(404).send({ error: 'Arquivo não encontrado' });
      }
      if (request.method === 'GET') {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
    app.log.info(`Servindo web em ${webDist}`);
  }

  const shutdown = async () => {
    await app.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}