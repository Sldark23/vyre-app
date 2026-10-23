import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { env } from '../env';
import { requireAuth } from './auth';
import { uploadToCdn, startCdnChunkedUpload, uploadCdnChunk, completeCdnChunkedUpload, cdn } from '../lib/cdn';
import crypto from 'node:crypto';

const MAX_NORMAL_UPLOAD = 20 * 1024 * 1024; // 20MB - above this uses chunked
const MAX_CHUNKED_UPLOAD = 200 * 1024 * 1024; // 200MB max for chunked

const ALLOWED_IMAGES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const ALLOWED_VIDEOS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

const ALLOWED = { ...ALLOWED_IMAGES, ...ALLOWED_VIDEOS };

export async function uploadRoutes(app: FastifyInstance) {
  // Register multipart once with max limits (validated per-route)
  await app.register(multipart, {
    limits: { fileSize: MAX_CHUNKED_UPLOAD, files: 1, fields: 10 },
  });

  const useCdn = !!env.cdnApiKey;

  // ============ UPLOAD NORMAL (imagens <= 20MB) ============
  app.post('/uploads', async (request, reply) => {
    requireAuth(request);
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });

    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      file.file.resume();
      return reply
        .code(415)
        .send({ error: 'Formato não suportado — use PNG, JPEG, GIF, WebP, MP4, WebM ou MOV' });
    }

    const isVideo = file.mimetype.startsWith('video/');

    // Videos SEMPRE vão para chunked (mesmo se pequenos)
    if (isVideo) {
      file.file.resume();
      return reply.code(400).send({ 
        error: 'Vídeos devem usar upload em chunks. Use POST /uploads/chunked/start' 
      });
    }

    // Imagens > 20MB vão para chunked - verifica pelo content-length do request
    const contentLength = request.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_NORMAL_UPLOAD) {
      file.file.resume();
      return reply.code(413).send({ 
        error: `Imagem > 20MB deve usar upload em chunks. Use POST /uploads/chunked/start` 
      });
    }

    if (useCdn) {
      try {
        const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const result = await uploadToCdn(file.file as any, filename, file.mimetype, MAX_NORMAL_UPLOAD);
        return reply.code(201).send({ url: result.url, filename: result.filename, size: result.size });
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Falha no upload para CDN' });
      }
    }

    // Fallback local
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { pipeline } = await import('node:stream/promises');

    fs.mkdirSync(env.uploadsDir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const dest = path.join(env.uploadsDir, name);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      return reply.code(413).send({ error: 'Arquivo muito grande (máx. 20MB)' });
    }
    return reply.code(201).send({ url: `${env.publicUrl}/uploads/${name}` });
  });

  // ============ UPLOAD EM CHUNKS (vídeos SEMPRE + imagens > 20MB) ============
  
  // Iniciar upload em chunks - gera uploadId UUID válido e calcula totalChunks
  app.post('/uploads/chunked/start', async (request, reply) => {
    requireAuth(request);
    if (!useCdn) {
      return reply.code(501).send({ error: 'Upload em chunks requer CDN configurado' });
    }

    const { filename, mimetype, totalSize } = request.body as {
      filename: string;
      mimetype: string;
      totalSize: number;
    };

    if (!filename || !mimetype || !totalSize) {
      return reply.code(400).send({ error: 'Campos obrigatórios: filename, mimetype, totalSize' });
    }

    if (!ALLOWED[mimetype]) {
      return reply.code(415).send({ error: 'Formato não suportado' });
    }

    if (totalSize > MAX_CHUNKED_UPLOAD) {
      return reply.code(413).send({ error: `Arquivo muito grande (máx. ${MAX_CHUNKED_UPLOAD} bytes)` });
    }

    try {
      const res = await startCdnChunkedUpload(filename, mimetype, totalSize);
      return reply.send({ 
        uploadId: res.uploadId, 
        chunkSize: res.chunkSize, 
        totalChunks: res.totalChunks 
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Falha ao iniciar upload em chunks' });
    }
  });

  // Upload de um chunk
  app.post('/uploads/chunked/:uploadId', async (request, reply) => {
    requireAuth(request);
    if (!useCdn) {
      return reply.code(501).send({ error: 'Upload em chunks requer CDN configurado' });
    }

    const { uploadId } = request.params as { uploadId: string };
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Nenhum chunk enviado' });

    const index = parseInt(request.headers['x-chunk-index'] as string || '0', 10);
    const totalChunks = parseInt(request.headers['x-total-chunks'] as string || '1', 10);
    const totalSize = parseInt(request.headers['x-total-size'] as string || '0', 10);
    const mimetype = request.headers['x-mimetype'] as string || file.mimetype;

    try {
      const buffer = await file.toBuffer();
      const res = await uploadCdnChunk(uploadId, buffer, index, totalChunks, totalSize, mimetype);
      if (!res.success) {
        return reply.code(500).send({ error: res.error || 'Falha no upload do chunk' });
      }
      return reply.send({ success: true, index });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Falha no upload do chunk' });
    }
  });

  // Finalizar upload em chunks
  app.post('/uploads/chunked/:uploadId/complete', async (request, reply) => {
    requireAuth(request);
    if (!useCdn) {
      return reply.code(501).send({ error: 'Upload em chunks requer CDN configurado' });
    }

    const { uploadId } = request.params as { uploadId: string };
    const { filename, mimetype, totalChunks } = request.body as {
      filename: string;
      mimetype: string;
      totalChunks: number;
    };

    if (!filename || !mimetype || !totalChunks) {
      return reply.code(400).send({ error: 'Campos obrigatórios: filename, mimetype, totalChunks' });
    }

    try {
      const res = await completeCdnChunkedUpload(uploadId, totalChunks, filename, mimetype);
      return reply.code(201).send({ url: res.url, filename: res.filename, size: 0 });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Falha ao finalizar upload' });
    }
  });

  // ============ UTILITÁRIOS CDN ============

  // Listar arquivos
  app.get('/uploads/files', async (request, reply) => {
    requireAuth(request);
    if (!useCdn) {
      return reply.code(501).send({ error: 'Listagem requer CDN configurado' });
    }

    try {
      const res = await cdn.listFiles();
      if (!res.success || !res.files) {
        return reply.code(500).send({ error: res.error || 'Falha ao listar arquivos' });
      }
      return reply.send({ files: res.files });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Falha ao listar arquivos' });
    }
  });

  // Deletar arquivo
  app.delete('/uploads/files/:filename', async (request, reply) => {
    requireAuth(request);
    if (!useCdn) {
      return reply.code(501).send({ error: 'Exclusão requer CDN configurado' });
    }

    const { filename } = request.params as { filename: string };
    try {
      const res = await cdn.deleteFile(filename);
      if (!res.success) {
        return reply.code(500).send({ error: res.error || 'Falha ao deletar arquivo' });
      }
      return reply.send({ success: true });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Falha ao deletar arquivo' });
    }
  });

  // Health check do CDN
  app.get('/uploads/health', async (_request, reply) => {
    if (!useCdn) {
      return reply.send({ cdn: false, local: true });
    }
    const healthy = await cdn.healthCheck();
    return reply.send({ cdn: healthy, local: true });
  });
}