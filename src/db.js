// ============================================================================
// db.js — leaderboard + session store.
//
// If DATABASE_URL is set, uses Postgres (production). Otherwise falls back to an
// in-memory store so `node server.js` works locally with zero setup.
//
// The interface is the same either way, so server.js doesn't care which is live.
// ============================================================================

import crypto from 'node:crypto';

const ROUND_MS = 60 * 60 * 1000;
export const roundId = (t = Date.now()) => Math.floor(t / ROUND_MS);

// ---------------------------------------------------------------------------
// In-memory implementation (local dev / fallback)
// ---------------------------------------------------------------------------
function memoryStore() {
  const board = new Map();          // `${round}:${player}` -> {name, score, t}
  const used = new Set();           // spent session ids
  return {
    kind: 'memory',
    async init() {},
    async markSessionUsed(id) { if (used.has(id)) return false; used.add(id); return true; },
    async recordScore(round, player, name, score) {
      const key = `${round}:${player}`;
      const prev = board.get(key);
      if (!prev || score > prev.score) { board.set(key, { name, score, t: Date.now() }); return true; }
      return false;
    },
    async topBoard(round, limit = 20) {
      return [...board.entries()]
        .filter(([k]) => k.startsWith(round + ':'))
        .map(([, v]) => v)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres implementation (production)
// ---------------------------------------------------------------------------
async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scores (
          round   BIGINT NOT NULL,
          player  TEXT   NOT NULL,
          name    TEXT   NOT NULL,
          score   INTEGER NOT NULL,
          updated TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (round, player)
        );
        CREATE INDEX IF NOT EXISTS scores_round_score ON scores (round, score DESC);
        CREATE TABLE IF NOT EXISTS used_sessions (
          id       TEXT PRIMARY KEY,
          used_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // opportunistic cleanup of old rounds (keep last 48h)
      await pool.query(`DELETE FROM scores WHERE round < $1`, [roundId() - 48]);
      await pool.query(`DELETE FROM used_sessions WHERE used_at < now() - interval '6 hours'`);
    },
    async markSessionUsed(id) {
      // atomic: insert succeeds only if not already present
      const r = await pool.query(
        `INSERT INTO used_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id`, [id]);
      return r.rowCount === 1;
    },
    async recordScore(round, player, name, score) {
      // keep best score per player per round
      const r = await pool.query(
        `INSERT INTO scores (round, player, name, score) VALUES ($1,$2,$3,$4)
         ON CONFLICT (round, player) DO UPDATE SET score = EXCLUDED.score, name = EXCLUDED.name, updated = now()
         WHERE scores.score < EXCLUDED.score
         RETURNING player`,
        [round, player, name, score]);
      return r.rowCount === 1;
    },
    async topBoard(round, limit = 20) {
      const r = await pool.query(
        `SELECT name, score, EXTRACT(EPOCH FROM updated)*1000 AS t
         FROM scores WHERE round = $1 ORDER BY score DESC LIMIT $2`, [round, limit]);
      return r.rows.map(x => ({ name: x.name, score: x.score, t: Number(x.t) }));
    },
  };
}

export async function makeStore() {
  const url = process.env.DATABASE_URL;
  const store = url ? await pgStore(url) : memoryStore();
  await store.init();
  console.log(`[db] using ${store.kind} store`);
  return store;
}
