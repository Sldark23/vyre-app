import pg from 'pg';
import { env } from '../env';

export const pool = new pg.Pool({
  connectionString: env.dbUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export function query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
  return pool.query(text, params as never[]);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
