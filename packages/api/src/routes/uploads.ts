import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { env } from '../env';
import { requireAuth } from './auth';

const MAX_UPLOAD = 8 * 1024 * 1024; // 8MB
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD, files: 1, fields: 0 },
  });

  // Upload de imagem (avatar, ícone de cluster, anexo de mensagem)
  app.post('/uploads', async (request, reply) => {
    requireAuth(request);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });

    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      file.file.resume(); // descarta
      return reply
        .code(415)
        .send({ error: 'Formato não suportado — use PNG, JPEG, GIF ou WebP' });
    }

    fs.mkdirSync(env.uploadsDir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const dest = path.join(env.uploadsDir, name);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      return reply.code(413).send({ error: 'Arquivo muito grande (máx. 8MB)' });
    }
    return reply.code(201).send({ url: `${env.publicUrl}/uploads/${name}` });
  });
}
