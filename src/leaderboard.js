// Leaderboard + 3-day season engine.
import { CONFIG, seasonId, GATED_ITEMS } from './config.js';
import { query } from './db.js';

// ---- score submission (with anti-cheat validation) ----
// Returns {accepted, rank, reason?}.
export async function submitScore({ wallet, name, score, durationMs, flight }) {
  score = Math.floor(Number(score));
  durationMs = Number(durationMs) || 0;
  name = String(name || 'anon').slice(0, 14);
  flight = String(flight || 'flap').slice(0, 16);

  // --- validation: cheap server-side plausibility checks ---
  if (!Number.isFinite(score) || score < 0) return { accepted: false, reason: 'bad_score' };
  if (score > CONFIG.MAX_PLAUSIBLE_SCORE) return { accepted: false, reason: 'score_too_high' };
  // a run of N points must have taken at least N * MIN_MS_PER_POINT ms.
  // (durationMs is reported by the client; it's a sanity gate, not proof. Real
  //  anti-cheat would replay inputs server-side — see notes in the spec.)
  if (score > 0 && durationMs > 0 && durationMs < score * CONFIG.MIN_MS_PER_POINT) {
    return { accepted: false, reason: 'too_fast' };
  }

  const sid = seasonId();
  // keep only the wallet's BEST score this season
  await query(
    `INSERT INTO scores (season_id, wallet, name, score, flight, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (season_id, wallet)
     DO UPDATE SET score = GREATEST(scores.score, EXCLUDED.score),
                   name = EXCLUDED.name,
                   flight = EXCLUDED.flight,
                   updated_at = now()`,
    [sid, wallet, name, score, flight]);

  const rank = await rankForWallet(sid, wallet);
  return { accepted: true, rank };
}

// current placement of a wallet in a season (1-based), or null
export async function rankForWallet(sid, wallet) {
  const { rows } = await query(
    `SELECT COUNT(*) + 1 AS rank
       FROM scores s
       JOIN scores me ON me.season_id = s.season_id AND me.wallet = $2
      WHERE s.season_id = $1
        AND (s.score > me.score
             OR (s.score = me.score AND s.updated_at < me.updated_at))`,
    [sid, wallet]);
  if (!rows.length) return null;
  // if the wallet has no score this season, the above still returns a number;
  // guard by checking existence
  const exists = await query(
    `SELECT 1 FROM scores WHERE season_id = $1 AND wallet = $2`, [sid, wallet]);
  return exists.rows.length ? Number(rows[0].rank) : null;
}

// top N of the current (or given) season
export async function leaderboard(limit = 100, sid = seasonId()) {
  const { rows } = await query(
    `SELECT name, wallet, score, flight,
            ROW_NUMBER() OVER (ORDER BY score DESC, updated_at ASC) AS rank
       FROM scores WHERE season_id = $1
      ORDER BY score DESC, updated_at ASC
      LIMIT $2`,
    [sid, limit]);
  return rows.map(r => ({
    rank: Number(r.rank), name: r.name, score: r.score, flight: r.flight,
    // expose a shortened wallet for display, never the full thing unnecessarily
    wallet: r.wallet.slice(0, 4) + '…' + r.wallet.slice(-4),
  }));
}

// ---- season finalisation ----
// When a season ends, snapshot final standings into permanent rank_awards.
// Idempotent: a season is only finalised once. Safe to call on every request /
// on a timer. Finalises ALL completed-but-unfinalised seasons up to (current-1).
export async function finaliseDueSeasons() {
  const current = seasonId();
  // find the latest finalised season
  const { rows } = await query(`SELECT COALESCE(MAX(season_id), $1 - 1) AS last FROM season_finalised`, [current]);
  let last = Number(rows[0].last);
  // finalise every season from last+1 up to current-1 (current is still running)
  for (let sid = last + 1; sid <= current - 1; sid++) {
    await finaliseSeason(sid);
  }
}

async function finaliseSeason(sid) {
  // already done?
  const done = await query(`SELECT 1 FROM season_finalised WHERE season_id = $1`, [sid]);
  if (done.rows.length) return;

  // rank everyone in that season; update each wallet's permanent best_rank
  // (cumulative model: keep the LOWEST/best placement they've ever achieved)
  await query(
    `WITH ranked AS (
       SELECT wallet,
              ROW_NUMBER() OVER (ORDER BY score DESC, updated_at ASC) AS place
         FROM scores WHERE season_id = $1
     )
     INSERT INTO rank_awards (wallet, best_rank, season_id, awarded_at)
     SELECT wallet, place, $1, now() FROM ranked
     ON CONFLICT (wallet) DO UPDATE
       SET best_rank = LEAST(rank_awards.best_rank, EXCLUDED.best_rank),
           season_id = CASE WHEN EXCLUDED.best_rank < rank_awards.best_rank
                            THEN EXCLUDED.season_id ELSE rank_awards.season_id END,
           awarded_at = now()`,
    [sid]);

  await query(`INSERT INTO season_finalised (season_id) VALUES ($1)
               ON CONFLICT (season_id) DO NOTHING`, [sid]);
  console.log('[season] finalised season', sid);
}

// a wallet's permanent best finalised rank (or null)
export async function bestRank(wallet) {
  const { rows } = await query(`SELECT best_rank FROM rank_awards WHERE wallet = $1`, [wallet]);
  return rows.length ? Number(rows[0].best_rank) : null;
}

// ---- compute the full unlock set for a wallet ----
// combines token tier (from balance) + earned rank (from finalised seasons)
export function computeUnlocks(balance, bestRankValue) {
  const T = CONFIG.TIERS, R = CONFIG.RANKS;
  const unlocked = [];

  // token-gated items: unlocked if balance >= that tier's threshold
  for (const [item, tier] of Object.entries(GATED_ITEMS.token)) {
    if (balance >= T[tier]) unlocked.push(item);
  }
  // rank-gated items: unlocked if bestRank <= that tier's required placement
  if (bestRankValue != null) {
    for (const [item, tier] of Object.entries(GATED_ITEMS.rank)) {
      if (bestRankValue <= R[tier]) unlocked.push(item);
    }
  }
  return unlocked;
}
