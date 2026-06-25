// Postgres connection pool. Railway injects DATABASE_URL when you add a Postgres plugin.
import pg from 'pg';
import { CONFIG } from './config.js';

const { Pool } = pg;

if (!CONFIG.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — the server will fail on any DB query. ' +
    'Add a Postgres plugin on Railway, or set DATABASE_URL locally.');
}

export const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  // Railway/most managed PG require SSL; locally you usually don't.
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

export function query(text, params) {
  return pool.query(text, params);
}
