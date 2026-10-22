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