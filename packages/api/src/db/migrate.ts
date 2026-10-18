import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[db] schema aplicado');
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate()
    .then(() => {
      console.log('[db] migração concluída');
      return pool.end();
    })
    .catch((err) => {
      console.error('[db] falha na migração:', err);
      process.exit(1);
    });
}
