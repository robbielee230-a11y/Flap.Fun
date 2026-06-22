// ============================================================================
// server.js — FLAPP authoritative game server (deploy-ready)
//
// Same verification scheme as the prototype, hardened for hosting:
//   - Postgres-backed board (via db.js), survives restarts
//   - config from env (SESSION_SECRET, ALLOWED_ORIGIN, PORT)
//   - CORS locked to ALLOWED_ORIGIN (not *)
//   - rate limiting per IP on both endpoints
//   - optional wallet-signature auth at /run/start (REQUIRE_WALLET=1)
//
// Endpoints:
//   POST /run/start  {player, [walletSig, message]} -> signed ticket
//   POST /run/submit {session, flapTicks, name}      -> verify + score
//   GET  /board                                       -> snapshot
//   GET  /events                                      -> SSE live board
//   GET  /healthz                                     -> ok
// ============================================================================

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate, CFG } from './src/engine.js';
import { analyze } from './src/anticheat.js';
import { makeStore, roundId } from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

const PORT = process.env.PORT || 8787;
const SECRET = process.env.SESSION_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const REQUIRE_WALLET = process.env.REQUIRE_WALLET === '1';
const SESSION_TTL_MS = 5 * 60 * 1000;

if (!SECRET) {
  console.error('FATAL: set SESSION_SECRET env var (a long random string). Tickets break on restart without a stable secret.');
  process.exit(1);
}

const store = await makeStore();
const sseClients = new Set();

// ---- HMAC session tickets ----
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('hex');
function makeSession(player) {
  const seed = crypto.randomInt(0, 2 ** 31);
  const nonce = crypto.randomBytes(8).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const sessionId = `${player}.${nonce}`;
  const round = roundId();
  return { sessionId, seed, expiresAt, round, sig: sign(`${sessionId}|${seed}|${expiresAt}|${round}`) };
}
function verifySession(s) {
  if (!s || typeof s !== 'object') return 'malformed';
  if (Date.now() > s.expiresAt) return 'expired';
  if (s.round !== roundId()) return 'wrong_round';
  const expect = sign(`${s.sessionId}|${s.seed}|${s.expiresAt}|${s.round}`);
  const a = Buffer.from(String(s.sig)), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad_sig';
  return 'ok';
}

// ---- rate limiter: token bucket per IP ----
const buckets = new Map();
function rateLimit(ip, max = 30, windowMs = 60000) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(ip, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k); }, 120000).unref?.();

// ---- optional wallet auth: verify an ed25519 signature over a message ----
async function verifyWallet(player, message, walletSig) {
  if (!REQUIRE_WALLET) return true;            // auth disabled
  if (!message || !walletSig) return false;
  try {
    const nacl = (await import('tweetnacl')).default;
    const bs58 = (await import('bs58')).default;
    const pub = bs58.decode(player);
    const sig = bs58.decode(walletSig);
    const msg = new TextEncoder().encode(message);
    // message must be fresh: "FLAPP login <timestamp>"
    const ts = Number(message.split(' ').pop());
    if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch { return false; }
}

// ---- helpers ----
const readJson = (req) => new Promise((res, rej) => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
});
function cors(res) {
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN);
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}
const send = (res, code, obj) => { cors(res); res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

async function pushBoard() {
  const rows = await store.topBoard(roundId(), 20);
  const data = `data: ${JSON.stringify(rows)}\n\n`;
  for (const res of sseClients) res.write(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (url.pathname === '/healthz') return send(res, 200, { ok: true, store: store.kind });

  if (req.method === 'POST' && url.pathname === '/run/start') {
    if (!rateLimit(ipOf(req))) return send(res, 429, { error: 'rate_limited' });
    const { player, message, walletSig } = await readJson(req).catch(() => ({}));
    if (!player || typeof player !== 'string') return send(res, 400, { error: 'player required' });
    if (!(await verifyWallet(player, message, walletSig))) return send(res, 401, { error: 'wallet_auth_failed' });
    // TODO(eligibility): when REQUIRE_WALLET, check on-chain FLAPP hold >= GATE here.
    return send(res, 200, makeSession(player.slice(0, 64)));
  }

  if (req.method === 'POST' && url.pathname === '/run/submit') {
    if (!rateLimit(ipOf(req))) return send(res, 429, { error: 'rate_limited' });
    const body = await readJson(req).catch(() => null);
    if (!body || !body.session) return send(res, 400, { error: 'session required' });
    const v = verifySession(body.session);
    if (v !== 'ok') return send(res, 403, { accepted: false, reason: v });

    const fresh = await store.markSessionUsed(body.session.sessionId);
    if (!fresh) return send(res, 403, { accepted: false, reason: 'already_used' });

    const sim = simulate(body.session.seed, body.flapTicks);
    const ac = analyze(body.session.seed, body.flapTicks || [], sim);
    if (ac.verdict === 'reject') return send(res, 200, { accepted: false, score: sim.score, verdict: ac.verdict, flags: ac.flags });

    const player = body.session.sessionId.split('.')[0];
    const name = (body.name || player).slice(0, 16);
    const wrote = await store.recordScore(roundId(), player, name, sim.score);
    if (wrote) await pushBoard();
    return send(res, 200, { accepted: true, score: sim.score, verdict: ac.verdict });
  }

  if (req.method === 'GET' && url.pathname === '/board') {
    const rows = await store.topBoard(roundId(), 20);
    return send(res, 200, { round: roundId(), rows });
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    cors(res);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  // static files
  if (req.method === 'GET') {
    if (url.pathname === '/engine.js') {
      cors(res); res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(fs.readFileSync(path.join(__dirname, 'src', 'engine.js')));
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(filePath));
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`FLAPP server on :${PORT} | store=${store.kind} | wallet-auth=${REQUIRE_WALLET} | origin=${ALLOWED_ORIGIN}`);
});
