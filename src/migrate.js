// Creates all tables. Idempotent — safe to run repeatedly.
// Run with: npm run migrate   (or it runs automatically on server start)
import { pool } from './db.js';

const SQL = `
-- one row per wallet per season per name: their BEST score that season
CREATE TABLE IF NOT EXISTS scores (
  id          BIGSERIAL PRIMARY KEY,
  season_id   BIGINT      NOT NULL,
  wallet      TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  score       INTEGER     NOT NULL CHECK (score >= 0),
  flight      TEXT        NOT NULL DEFAULT 'flap',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, wallet)
);
CREATE INDEX IF NOT EXISTS scores_season_rank
  ON scores (season_id, score DESC, updated_at ASC);

-- short-lived sign-in challenges (proof of wallet ownership)
CREATE TABLE IF NOT EXISTS nonces (
  wallet     TEXT PRIMARY KEY,
  nonce      TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- cache of on-chain token balances so we don't hammer the RPC
CREATE TABLE IF NOT EXISTS balance_cache (
  wallet      TEXT PRIMARY KEY,
  balance     DOUBLE PRECISION NOT NULL,
  fetched_at  TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- permanent record of rank rewards earned from COMPLETED seasons.
-- best_rank = lowest (best) final placement the wallet has ever achieved.
CREATE TABLE IF NOT EXISTS rank_awards (
  wallet     TEXT PRIMARY KEY,
  best_rank  INTEGER     NOT NULL,
  season_id  BIGINT      NOT NULL,   -- which season produced this best
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tracks which seasons have been finalised (so we only snapshot once)
CREATE TABLE IF NOT EXISTS season_finalised (
  season_id  BIGINT PRIMARY KEY,
  finalised_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate() {
  await pool.query(SQL);
  console.log('[migrate] schema ready');
}

// allow running directly: `node src/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
