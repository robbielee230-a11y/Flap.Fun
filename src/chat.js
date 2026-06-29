// Live global chat over WebSockets (path: /chat).
// SAFETY-FIRST DESIGN — a public chat on a token project is a moderation surface,
// so this layers several protections rather than relying on a word list alone:
//   - SIGNED-IN ONLY: must present a valid session token (a real wallet) to post.
//     Anonymous sockets can READ but never SEND. This gives accountability.
//   - LINK + ADDRESS BLOCKING: URLs, "dot-com" style domains, and Solana-looking
//     wallet/mint addresses are rejected. This is the #1 scam vector for crypto
//     communities (drainer links, "send 1 SOL get 2 back", fake mints).
//   - WORD FILTER: hate speech / slurs / the worst profanity are blocked, with
//     light leet/space evasion handling. (No filter is complete — this is a floor.)
//   - RATE LIMIT: per-wallet cooldown + short burst cap to stop flooding.
//   - LENGTH CAP + PLAIN TEXT ONLY: HTML/markup stripped to prevent injection.
//   - MUTE LIST: wallets in CHAT_MUTED (env, comma-separated) are silently blocked.
//
// NOTE: this is a safety floor, not a guarantee. A live community still needs human
// moderation. Keep CHAT_MUTED handy and consider disabling chat (CHAT_ENABLED=0)
// if it gets abused faster than you can watch it.

import { WebSocketServer } from 'ws';
import { verifySessionToken } from './auth.js';

const MAX_LEN = 240;
const HISTORY = 40;                 // messages kept for new joiners
const MIN_INTERVAL_MS = 1500;       // min gap between a wallet's messages
const BURST = 5;                    // max messages in BURST_WINDOW
const BURST_WINDOW_MS = 12000;

const history = [];                 // recent {name, wallet, text, ts}
const lastSent = new Map();         // wallet -> ts of last message
const burstLog = new Map();         // wallet -> [timestamps]

function muted() {
  return new Set(
    String(process.env.CHAT_MUTED || '')
      .split(',').map(s => s.trim()).filter(Boolean));
}

// ---- content filters ----
// crude but effective leet-normaliser for evasion (s1ck -> sick, etc.)
function normalise(s) {
  return s.toLowerCase()
    .replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e')
    .replace(/4|@/g, 'a').replace(/5|\$/g, 's').replace(/7/g, 't')
    .replace(/[^a-z]/g, '');         // collapse spacing/punctuation evasion
}

// Blocklist: hate speech, slurs, and the strongest profanity. Stored as the
// normalised forms we test against. (Kept intentionally focused; this is a floor,
// not an exhaustive list.) The check is substring-on-normalised so spacing and
// basic leet are caught.
// Two lists:
//  SUBSTR = slurs / hate terms we match even when embedded (to defeat evasion).
//  WORD   = strong words that must match as a WHOLE word, so we don't nuke innocent
//           words ("rape" inside "grape"/"scrape", "spic" inside "suspicious", etc).
const SUBSTR = [
  'nigger','nigga','faggot','tranny','chink','kike','coon','wetback','paki',
  'pedophile','molest',
].map(normalise);
const WORD = [
  'fag','retard','spic','cunt','rape','rapist','pedo','kys','killyourself',
].map(normalise);

function hasBlockedWord(text) {
  const n = normalise(text);                       // collapsed form (evasion-proof)
  if (SUBSTR.some(w => w && n.includes(w))) return true;
  // word-boundary check on the lightly-normalised (spacing kept) form
  const words = text.toLowerCase()
    .replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e')
    .replace(/4|@/g, 'a').replace(/5|\$/g, 's').replace(/7/g, 't')
    .split(/[^a-z]+/).filter(Boolean);
  return words.some(w => WORD.includes(w));
}

// links / domains / wallet & mint addresses
const URL_RE = /(https?:\/\/|www\.)/i;
const DOMAIN_RE = /\b[a-z0-9-]+\.(com|net|org|io|xyz|fun|app|gg|co|me|to|link|finance|fi|live|info|biz|click|vip|wtf|lol|cc|sol)\b/i;
const SOL_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/; // base58 32-44 chars ~ wallet/mint
function hasLinkOrAddress(text) {
  return URL_RE.test(text) || DOMAIN_RE.test(text) || SOL_ADDR_RE.test(text);
}

// strip anything HTML-ish and control chars; collapse whitespace
function clean(text) {
  return String(text || '')
    .replace(/[<>]/g, '')           // no tags
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

function rateOk(wallet) {
  const now = Date.now();
  const last = lastSent.get(wallet) || 0;
  if (now - last < MIN_INTERVAL_MS) return false;
  const log = (burstLog.get(wallet) || []).filter(t => now - t < BURST_WINDOW_MS);
  if (log.length >= BURST) return false;
  log.push(now); burstLog.set(wallet, log); lastSent.set(wallet, now);
  return true;
}

function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }

export function attachChat(httpServer) {
  if (String(process.env.CHAT_ENABLED || '1') === '0') {
    console.log('[chat] disabled via CHAT_ENABLED=0');
    return;
  }
  const wss = new WebSocketServer({ server: httpServer, path: '/chat' });

  function broadcast(obj) {
    const data = JSON.stringify(obj);
    wss.clients.forEach(c => { try { if (c.readyState === 1) c.send(data); } catch (e) {} });
  }

  wss.on('connection', (ws) => {
    ws._wallet = null; ws._name = 'Guest';
    // send recent history immediately (read access for everyone)
    send(ws, { t: 'history', messages: history });

    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.t === 'auth') {
        // identify the socket via session token so it can post
        ws._wallet = msg.session ? verifySessionToken(msg.session) : null;
        ws._name = String(msg.name || 'Player').slice(0, 14).replace(/[<>]/g, '');
        send(ws, { t: 'authed', canPost: !!ws._wallet });
        return;
      }

      if (msg.t === 'say') {
        // must be signed in
        if (!ws._wallet) { send(ws, { t: 'blocked', reason: 'signin_required',
          message: 'Sign in with your wallet to chat.' }); return; }
        if (muted().has(ws._wallet)) { send(ws, { t: 'blocked', reason: 'muted',
          message: 'You are muted.' }); return; }

        const text = clean(msg.text);
        if (!text) return;
        if (!rateOk(ws._wallet)) { send(ws, { t: 'blocked', reason: 'rate',
          message: 'Slow down a moment.' }); return; }
        if (hasLinkOrAddress(text)) { send(ws, { t: 'blocked', reason: 'link',
          message: 'Links and wallet addresses aren’t allowed in chat.' }); return; }
        if (hasBlockedWord(text)) { send(ws, { t: 'blocked', reason: 'filtered',
          message: 'That message was blocked by the filter.' }); return; }

        const entry = { name: ws._name, wallet: ws._wallet.slice(0,4)+'…'+ws._wallet.slice(-4),
                        text, ts: Date.now() };
        history.push(entry);
        if (history.length > HISTORY) history.shift();
        broadcast({ t: 'msg', ...entry });
      }
    });
  });

  console.log('[chat] live chat attached on /chat');
}
