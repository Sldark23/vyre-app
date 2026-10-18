import { buildApp } from './app';
import { env } from './env';
import { migrate } from './db/migrate';
import { pool } from './db';

async function main() {
  await migrate();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  console.log(`[vyre] API rodando em http://0.0.0.0:${env.port}`);

  const shutdown = async () => {
    console.log('\n[vyre] encerrando...');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[vyre] falha ao iniciar:', err);
  process.exit(1);
});
