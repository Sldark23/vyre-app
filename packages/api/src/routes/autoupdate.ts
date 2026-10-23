import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { env } from '../env';
import { requireAuth } from './auth';

type UpdateChannel = 'stable' | 'betatest' | 'restrito';

interface UpdateInfo {
  version: string;
  buildNumber: number;
  channel: UpdateChannel;
  releaseNotes: string;
  downloadUrl: string;
  mandatory: boolean;
  minAppVersion: string;
  signature: string;
  size: number;
}

const createUpdateSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  buildNumber: z.number().int().positive(),
  channel: z.enum(['stable', 'betatest', 'restrito']),
  releaseNotes: z.string().max(5000),
  apkPath: z.string(),
  mandatory: z.boolean().default(false),
  minAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
});

export async function autoupdateRoutes(app: FastifyInstance) {
  // Test endpoint
  app.get('/autoupdate/test', async () => {
    return { ok: true, message: 'Autoupdate routes working' };
  });

  // Verificar atualização (público - sem auth para permitir verificação antes do login)
  app.get('/autoupdate/check', async (request, reply) => {
    const { channel, currentVersion, currentBuild, platform } = request.query as {
      channel: UpdateChannel;
      currentVersion: string;
      currentBuild: string;
      platform: 'android' | 'ios';
    };

    if (!channel || !['stable', 'betatest', 'restrito'].includes(channel)) {
      return reply.code(400).send({ error: 'Canal inválido' });
    }
    if (!currentVersion || !currentBuild) {
      return reply.code(400).send({ error: 'Versão e build atuais obrigatórios' });
    }

    try {
      const result = await query(
        `SELECT * FROM app_updates 
         WHERE channel = $1 AND platform = $2 
         ORDER BY build_number DESC LIMIT 1`,
        [channel, platform]
      );

      const update = result.rows[0];
      if (!update) {
        return reply.send({ hasUpdate: false });
      }

      const currentBuildNum = parseInt(currentBuild, 10);
      const hasUpdate = update.build_number > currentBuildNum;

      if (!hasUpdate) {
        return reply.send({ hasUpdate: false });
      }

      const publicUrl = env.publicUrl.replace(/\/$/, '');
      const downloadUrl = `${publicUrl}/api/v1/autoupdate/download/${update.id}`;

      return reply.send({
        hasUpdate: true,
        update: {
          version: update.version,
          buildNumber: update.build_number,
          channel: update.channel,
          releaseNotes: update.release_notes,
          downloadUrl,
          mandatory: update.mandatory,
          minAppVersion: update.min_app_version,
          signature: update.signature,
          size: update.size,
        },
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Erro ao verificar atualização' });
    }
  });

  // Download do APK (público)
  app.get('/autoupdate/download/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      const result = await query('SELECT * FROM app_updates WHERE id = $1', [id]);
      const update = result.rows[0];
      
      if (!update) {
        return reply.code(404).send({ error: 'Atualização não encontrada' });
      }

      // Aqui serviria o arquivo APK do storage
      // Por enquanto retorna URL de download
      const publicUrl = env.publicUrl.replace(/\/$/, '');
      const downloadUrl = `${publicUrl}/uploads/apks/${update.apk_filename}`;
      
      return reply.redirect(downloadUrl);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Erro no download' });
    }
  });

  // CI/Upload: Criar nova atualização via multipart
  app.post('/autoupdate/upload', async (request, reply) => {
    // Tentar autenticar com token de admin ou via header
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || token !== env.autoUpdateToken) {
      // Também permitir se for admin autenticado
      try {
        const userId = requireAuth(request);
        const user = await query('SELECT username FROM users WHERE id = $1', [userId]);
        if (!user.rows[0] || user.rows[0].username !== 'admin') {
          return reply.code(403).send({ error: 'Não autorizado' });
        }
      } catch {
        return reply.code(401).send({ error: 'Não autenticado' });
      }
    }

    await app.register(async (child) => {
      await child.register((await import('@fastify/multipart')).default, {
        limits: { fileSize: 150 * 1024 * 1024, files: 1, fields: 50 },
      });

      child.post('/', async (req, rep) => {
        const file = await req.file();
        if (!file) return rep.code(400).send({ error: 'Nenhum arquivo enviado' });

        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.body as Record<string, unknown> || {})) {
          if (v && typeof (v as any) === 'object' && 'value' in (v as any)) {
            fields[k] = (v as any).value;
          } else if (typeof v === 'string') {
            fields[k] = v;
          }
        }

        const version = fields.version || fields.versionName;
        const buildNumber = parseInt(fields.buildNumber || fields.versionCode || '1', 10);
        const channel = (fields.channel as UpdateChannel) || 'stable';
        const releaseNotes = fields.releaseNotes || fields.notes || '';
        const platform = (fields.platform as 'android' | 'ios') || 'android';

        if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
          return rep.code(400).send({ error: 'Versão inválida' });
        }
        if (!['stable', 'betatest', 'restrito'].includes(channel)) {
          return rep.code(400).send({ error: 'Canal inválido' });
        }

        const fs = await import('node:fs');
        const fsPromises = await import('node:fs/promises');
        const path = await import('node:path');
        const crypto = await import('node:crypto');

        const uploadsDir = path.join(process.cwd(), '..', 'uploads', 'apks');
        await fsPromises.mkdir(uploadsDir, { recursive: true });

        const ext = file.filename?.endsWith('.aab') ? 'aab' : 'apk';
        const apkFilename = `vyre-${channel}-v${version}-b${buildNumber}.${ext}`;
        const destPath = path.join(uploadsDir, apkFilename);

        const stream = fs.createWriteStream(destPath);
        await new Promise<void>((resolve, reject) => {
          file.file.pipe(stream);
          file.file.on('error', reject);
          stream.on('finish', resolve);
          stream.on('error', reject);
        });

        const apkBuffer = fs.readFileSync(destPath);
        const signature = crypto.createHash('sha256').update(apkBuffer).digest('hex');
        const size = apkBuffer.length;

        const result = await query(
          `INSERT INTO app_updates (version, build_number, channel, platform, release_notes, apk_filename, mandatory, min_app_version, signature, size)
           VALUES ($1, $2, $3, $4, $5, $6, false, null, $7, $8)
           RETURNING *`,
          [version, buildNumber, channel, platform, releaseNotes, apkFilename, signature, size]
        );

        return rep.code(201).send({ update: result.rows[0], apkFilename });
      });
    }, { prefix: '/' });

    return (request as any).server.inject({ method: 'POST', url: '/', headers: request.headers, payload: (request as any).raw || request.rawBody });
  });

  // Admin: Criar nova atualização
  app.post('/autoupdate', async (request, reply) => {
    const userId = requireAuth(request);
    
    // Verificar se é admin (simplificado - pode expandir)
    const user = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!user.rows[0] || user.rows[0].username !== 'admin') {
      return reply.code(403).send({ error: 'Apenas admins podem criar atualizações' });
    }

    const parsed = createUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Dados inválidos' });
    }

    const { version, buildNumber, channel, releaseNotes, apkPath, mandatory, minAppVersion } = parsed.data;

    try {
      // Gerar assinatura do APK
      const crypto = await import('node:crypto');
      const fs = await import('node:fs');
      const apkBuffer = fs.readFileSync(apkPath);
      const signature = crypto.createHash('sha256').update(apkBuffer).digest('hex');
      const size = apkBuffer.length;

      // Mover APK para pasta de uploads
      const fsPromises = await import('node:fs/promises');
      const path = await import('node:path');
      const uploadsDir = path.join(process.cwd(), '..', 'uploads', 'apks');
      await fsPromises.mkdir(uploadsDir, { recursive: true });
      
      const apkFilename = `vyre-${channel}-v${version}-b${buildNumber}.apk`;
      const destPath = path.join(uploadsDir, apkFilename);
      await fsPromises.copyFile(apkPath, destPath);

      const result = await query(
        `INSERT INTO app_updates (version, build_number, channel, platform, release_notes, apk_filename, mandatory, min_app_version, signature, size)
         VALUES ($1, $2, $3, 'android', $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [version, buildNumber, channel, releaseNotes, apkFilename, mandatory, minAppVersion || null, signature, size]
      );

      return reply.code(201).send({ update: result.rows[0] });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Erro ao criar atualização' });
    }
  });

  // Listar atualizações
  app.get('/autoupdate', async (request, reply) => {
    requireAuth(request);
    const result = await query(
      `SELECT * FROM app_updates ORDER BY created_at DESC LIMIT 50`
    );
    return reply.send({ updates: result.rows });
  });

  // Deletar atualização
  app.delete('/autoupdate/:id', async (request, reply) => {
    requireAuth(request);
    const { id } = request.params as { id: string };
    await query('DELETE FROM app_updates WHERE id = $1', [id]);
    return reply.send({ ok: true });
  });
}

export { createUpdateSchema };