// Flappy backend API server.
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { CONFIG, seasonId, seasonBounds } from './config.js';
import { migrate } from './migrate.js';
import { issueNonce, verifySignature, requireAuth, isValidWallet } from './auth.js';
import { getBalance, tierForBalance } from './solana.js';
import { attachMultiplayer } from './multiplayer.js';
import {
  submitScore, leaderboard, finaliseDueSeasons, bestRank, computeUnlocks, rankForWallet,
  vsWinsLeaderboard,
} from './leaderboard.js';

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy; needed for rate-limit IPs
app.use(express.json({ limit: '16kb' }));
app.use(cors({
  origin: CONFIG.ALLOWED_ORIGINS.includes('*') ? true : CONFIG.ALLOWED_ORIGINS,
}));

// basic rate limits
const tight = rateLimit({ windowMs: 60_000, max: 30 });   // auth + score submit
const loose = rateLimit({ windowMs: 60_000, max: 120 });  // reads

// run season finalisation opportunistically (cheap, idempotent) before sensitive reads
async function withFinalise(req, res, next) {
  try { await finaliseDueSeasons(); } catch (e) { console.warn('[finalise]', e.message); }
  next();
}

app.get('/health', (req, res) => res.json({ ok: true, season: seasonId() }));

// ---- AUTH: prove wallet ownership ----
app.post('/auth/nonce', tight, async (req, res) => {
  const { wallet } = req.body || {};
  if (!isValidWallet(wallet)) return res.status(400).json({ error: 'bad_wallet' });
  try { res.json(await issueNonce(wallet)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

app.post('/auth/verify', tight, async (req, res) => {
  const { wallet, signature, nonce } = req.body || {};
  if (!isValidWallet(wallet) || !signature || !nonce)
    return res.status(400).json({ error: 'bad_request' });
  try { res.json(await verifySignature(wallet, signature, nonce)); }
  catch (e) { res.status(401).json({ error: e.message }); }
});

// ---- UNLOCKS: authoritative token-tier + rank skin set for the logged-in wallet ----
app.get('/unlocks', loose, requireAuth, withFinalise, async (req, res) => {
  try {
    const balance = await getBalance(req.wallet);
    const br = await bestRank(req.wallet);
    res.json({
      wallet: req.wallet.slice(0, 4) + '…' + req.wallet.slice(-4),
      balance,
      tier: tierForBalance(balance),
      bestRank: br,
      unlocked: computeUnlocks(balance, br),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

// ---- SCORES ----
// submit a competitive score (auth required so scores tie to a verified wallet)
app.post('/scores', tight, requireAuth, async (req, res) => {
  const { name, score, durationMs, flight } = req.body || {};
  try {
    // ENTRY THRESHOLD: to rank on the high-score board the wallet must HOLD at
    // least HIGHSCORE_ENTRY_THRESHOLD FLAP (held, never spent). Live-checked so
    // selling your FLAP drops you out. Set the amount via env (default 100).
    if (CONFIG.TOKEN_MINT && CONFIG.HIGHSCORE_ENTRY_THRESHOLD > 0) {
      const balance = await getBalance(req.wallet);
      if (balance < CONFIG.HIGHSCORE_ENTRY_THRESHOLD) {
        return res.status(403).json({ accepted: false, reason: 'below_threshold',
          need: CONFIG.HIGHSCORE_ENTRY_THRESHOLD, have: balance });
      }
    }
    const result = await submitScore({ wallet: req.wallet, name, score, durationMs, flight });
    if (!result.accepted) return res.status(422).json(result);
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

// public leaderboard for the current season + countdown
app.get('/leaderboard', loose, withFinalise, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 200);
  try {
    const sid = seasonId();
    const { end } = seasonBounds(sid);
    res.json({
      season: sid,
      endsAt: end,
      remainingMs: Math.max(0, end - Date.now()),
      board: await leaderboard(limit, sid),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

// public 1v1 WINS leaderboard for the current season
app.get('/leaderboard/wins', loose, withFinalise, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 200);
  try {
    const sid = seasonId();
    const { end } = seasonBounds(sid);
    res.json({
      season: sid,
      endsAt: end,
      remainingMs: Math.max(0, end - Date.now()),
      board: await vsWinsLeaderboard(limit, sid),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

// the logged-in wallet's current standing this season
app.get('/me/rank', loose, requireAuth, async (req, res) => {
  try {
    const sid = seasonId();
    res.json({ season: sid, liveRank: await rankForWallet(sid, req.wallet), bestRank: await bestRank(req.wallet) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server_error' }); }
});

// ---- serve the game's static files (public/) ----
// The game's index.html lives in ../public relative to this file (src/server.js).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---- boot ----
const PORT = CONFIG.PORT;
const httpServer = http.createServer(app);
attachMultiplayer(httpServer);   // WebSocket 1v1 at /ws

migrate()
  .then(() => finaliseDueSeasons().catch(() => {}))
  .then(() => {
    httpServer.listen(PORT, () => console.log(`[flappy-backend] http+ws on :${PORT} (season ${seasonId()})`));
  })
  .catch(e => { console.error('[boot] failed:', e); process.exit(1); });

// also run finalisation on a timer so seasons roll over even with no traffic
setInterval(() => finaliseDueSeasons().catch(() => {}), 5 * 60 * 1000);
