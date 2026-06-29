// Central config. Everything tunable lives here or in environment variables.
import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  // Postgres connection string. On Railway, add a Postgres plugin and it injects DATABASE_URL.
  DATABASE_URL: process.env.DATABASE_URL,
  // secret used to sign session JWTs. SET A REAL ONE in production (openssl rand -hex 32).
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-change-me',
  // how long a session (proof of wallet ownership) lasts
  SESSION_TTL_SECONDS: parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10), // 24h
  // CORS: comma-separated list of allowed origins (your game's URL). '*' for dev.
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()),

  // ----- Solana / token -----
  // your coin's SPL mint address. Empty = token gating disabled (balance always 0).
  TOKEN_MINT: process.env.TOKEN_MINT || '',
  // RPC endpoint. Public mainnet is rate-limited; use Helius/Triton/QuickNode in prod.
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  // cache a wallet's balance for this many seconds to avoid hammering the RPC
  BALANCE_CACHE_SECONDS: parseInt(process.env.BALANCE_CACHE_SECONDS || '60', 10),

  // token tier thresholds (whole tokens held -> tier). Mirror the game's TWEAK ZONE 11.
  TIERS: { t1: 100, t2: 1000, t3: 10000, t4: 50000, t5: 250000, t6: 1000000 },
  // FLAP a wallet must HOLD to rank on the high-score board (held, not spent).
  HIGHSCORE_ENTRY_THRESHOLD: parseInt(process.env.HIGHSCORE_ENTRY_THRESHOLD || '100', 10),
  // hold this many FLAP to access 1v1 (skin prizes). Default 250k.
  VS_UNLOCK_THRESHOLD: parseInt(process.env.VS_UNLOCK_THRESHOLD || '250000', 10),

  // rank tiers (required final placement -> tier). Mirror the game's RANK.
  RANKS: { r1: 1, r3: 3, r10: 10, r30: 30, r100: 100 },

  // ----- seasons -----
  // season length in milliseconds (3 days). Seasons are derived from epoch time so
  // every server/client agrees without coordination: seasonId = floor(now / SEASON_MS).
  SEASON_MS: parseInt(process.env.SEASON_MS || String(24 * 60 * 60 * 1000), 10),

  // ----- anti-cheat (score validation) -----
  // reject scores above this hard ceiling outright
  MAX_PLAUSIBLE_SCORE: parseInt(process.env.MAX_PLAUSIBLE_SCORE || '100000', 10),
  // a run must last at least this many ms per point (pipes can't be cleared faster than this).
  // tune to your game's pipe spacing/speed. Conservative default.
  MIN_MS_PER_POINT: parseInt(process.env.MIN_MS_PER_POINT || '300', 10),
};

// which cosmetic/character IDs map to which gate. Keep in sync with the game's
// CHARACTERS / COLORS_LIB / HATS / COSTUMES `req` and `rank` fields.
// This is the SERVER's source of truth for what unlocks at each tier/rank.
export const GATED_ITEMS = {
  token: {
    // colours
    shadow: 't1', ghost: 't1', ember: 't2', rainbow: 't3',
    // hats
    halo: 't1', wizard: 't2', crown: 't3',
    // costumes
    cape: 't1', armor: 't2', wings: 't2', jetpack: 't3',
    // characters
    duck: 't4', sub: 't4', laserbot: 't4', mech: 't5', dragon: 't5', phoenix: 't5',
    flamewyrm: 't5',
    griffin: 't5', pegasus: 't5', thunderbird: 't6', cosmic: 't6',
  },
  rank: {
    // rank-gated characters
    rookie: 'r100', veteran: 'r30', elite: 'r10', champion: 'r3', legend: 'r1',
  },
};

export function seasonId(now = Date.now()) {
  return Math.floor(now / CONFIG.SEASON_MS);
}
export function seasonBounds(id = seasonId()) {
  return { start: id * CONFIG.SEASON_MS, end: (id + 1) * CONFIG.SEASON_MS };
}

