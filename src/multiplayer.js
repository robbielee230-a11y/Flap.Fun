// Real-time 1v1 multiplayer over WebSockets.
// - Auto-matchmaking queue: first two waiting players are paired.
// - Each match gets a shared random SEED so both clients generate the IDENTICAL
//   pipe course (deterministic). We never stream pipes — just the seed.
// - Each client sends its bird state (~20/s); the server relays it to the
//   opponent. Clients interpolate the opponent's bird for smoothness.
// - Server signals: matched -> countdown -> go -> (live relay) -> gameover.
//
// Message protocol (JSON over WS), {t: type, ...}:
//   client→server: hello{name,character}, ready, state{y,vy,rot,score,tick},
//                  dead{score}, leave
//   server→client: queued, matched{seed,opponent,side}, countdown{n}, go,
//                  opp{y,vy,rot,score,alive}, result{youWon,you,opp}, oppLeft
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { verifySessionToken } from './auth.js';
import { recordVsWin } from './leaderboard.js';
import { getBalance } from './solana.js';
import { CONFIG } from './config.js';

const QUEUE = [];            // sockets waiting for a match
const MATCHES = new Map();   // matchId -> match

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

// broadcast live online + queue counts to every connected client
function broadcastStats(wss) {
  let online = 0;
  wss.clients.forEach((c) => { if (c.readyState === c.OPEN) online++; });
  const payload = JSON.stringify({ t: 'stats', online, queue: QUEUE.length });
  wss.clients.forEach((c) => { if (c.readyState === c.OPEN) { try { c.send(payload); } catch {} } });
}

function makeMatch(a, b) {
  const id = crypto.randomBytes(8).toString('hex');
  // 32-bit seed both clients use to generate identical pipes
  const seed = (crypto.randomBytes(4).readUInt32BE(0)) >>> 0;
  const match = {
    id, seed,
    players: [
      { ws: a, name: a._name, character: a._character, wallet: a._wallet || null, ready: false, alive: true, score: 0 },
      { ws: b, name: b._name, character: b._character, wallet: b._wallet || null, ready: false, alive: true, score: 0 },
    ],
    started: false, ended: false, countdownStarted: false,
  };
  a._matchId = id; a._side = 0;
  b._matchId = id; b._side = 1;
  MATCHES.set(id, match);

  // tell each player about the match + who they're facing + the shared seed
  send(a, { t: 'matched', seed, side: 0, opponent: { name: b._name, character: b._character, color: b._color, hat: b._hat, costume: b._costume } });
  send(b, { t: 'matched', seed, side: 1, opponent: { name: a._name, character: a._character, color: a._color, hat: a._hat, costume: a._costume } });
  return match;
}

function tryMatchmake() {
  while (QUEUE.length >= 2) {
    const a = QUEUE.shift();
    const b = QUEUE.shift();
    // skip dead sockets
    if (!a || a.readyState !== a.OPEN) { if (b) QUEUE.unshift(b); continue; }
    if (!b || b.readyState !== b.OPEN) { QUEUE.unshift(a); continue; }
    makeMatch(a, b);
  }
}

function opponentOf(match, side) { return match.players[side ? 0 : 1]; }

function beginCountdown(match) {
  if (match.countdownStarted) return;
  match.countdownStarted = true;
  let n = 3;
  const tick = () => {
    if (match.ended) return;
    if (n > 0) {
      for (const p of match.players) send(p.ws, { t: 'countdown', n });
      n--; setTimeout(tick, 1000);
    } else {
      match.started = true;
      for (const p of match.players) send(p.ws, { t: 'go' });
    }
  };
  tick();
}

function endMatch(match, reason) {
  if (match.ended) return;
  match.ended = true;
  const [p0, p1] = match.players;
  // winner = higher score; if a player left, the other wins
  let win0;
  if (reason === 'left0') win0 = false;
  else if (reason === 'left1') win0 = true;
  else win0 = p0.score >= p1.score;
  const winner = win0 ? p0 : p1;
  const recorded = !!(winner && winner.wallet);
  send(p0.ws, { t: 'result', youWon: win0, you: p0.score, opp: p1.score, reason, counted: win0 && recorded });
  send(p1.ws, { t: 'result', youWon: !win0, you: p1.score, opp: p0.score, reason, counted: !win0 && recorded });
  // record the win for the prize leaderboard — only if the winner is a verified
  // (signed-in) wallet. Anonymous wins don't count.
  if (recorded) {
    console.log('[vs_wins] recording win for', winner.wallet, '(', winner.name, ')');
    recordVsWin({ wallet: winner.wallet, name: winner.name })
      .then(() => console.log('[vs_wins] recorded OK for', winner.wallet))
      .catch(e => console.warn('[vs_wins] record FAILED:', e.message));
  } else {
    console.log('[vs_wins] win NOT counted — winner has no verified wallet. p0.wallet=',
      p0.wallet, 'p1.wallet=', p1.wallet, 'reason=', reason);
  }
  MATCHES.delete(match.id);
}

function maybeFinish(match) {
  // match ends when BOTH players are dead
  if (match.players.every(p => !p.alive)) endMatch(match, 'both-dead');
}

export function attachMultiplayer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    ws._name = 'Player';
    ws._character = 'bird';
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    broadcastStats(wss);   // someone joined → update everyone's counts

    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      const match = ws._matchId ? MATCHES.get(ws._matchId) : null;

      switch (msg.t) {
        case 'hello': {
          ws._name = String(msg.name || 'Player').slice(0, 14);
          ws._character = String(msg.character || 'bird').slice(0, 24);
          ws._color = String(msg.color || 'classic').slice(0, 24);
          ws._hat = String(msg.hat || 'none').slice(0, 24);
          ws._costume = String(msg.costume || 'none').slice(0, 24);
          // if they sent a session token, verify it so wins can be attributed to
          // their real wallet. Anonymous players can still play, but their wins
          // won't count toward the prize leaderboard.
          ws._wallet = msg.session ? verifySessionToken(msg.session) : null;
          // ---- 250k FLAP hold-gate (server-enforced; client check is bypassable) ----
          // Only enforced when a token is configured. Must be signed in AND hold the
          // threshold to access 1v1.
          (async () => {
            if (CONFIG.TOKEN_MINT && CONFIG.VS_UNLOCK_THRESHOLD > 0) {
              if (!ws._wallet) {
                send(ws, { t: 'gated', reason: 'signin_required',
                  need: CONFIG.VS_UNLOCK_THRESHOLD,
                  message: 'Sign in with a wallet holding ' + CONFIG.VS_UNLOCK_THRESHOLD.toLocaleString() + ' FLAP to play 1v1.' });
                return;
              }
              let bal = 0;
              try { bal = await getBalance(ws._wallet); } catch (e) { bal = 0; }
              if (bal < CONFIG.VS_UNLOCK_THRESHOLD) {
                send(ws, { t: 'gated', reason: 'below_threshold',
                  need: CONFIG.VS_UNLOCK_THRESHOLD, have: bal,
                  message: 'Hold ' + CONFIG.VS_UNLOCK_THRESHOLD.toLocaleString() + ' FLAP to play 1v1 (you have ' + Math.floor(bal).toLocaleString() + ').' });
                return;
              }
            }
            // passed the gate (or no token configured) → join the matchmaking queue
            if (!QUEUE.includes(ws) && !ws._matchId) {
              QUEUE.push(ws);
              send(ws, { t: 'queued', position: QUEUE.length });
              tryMatchmake();
              broadcastStats(wss);
            }
          })();
          break;
        }
        case 'ready': {
          if (!match) break;
          const me = match.players[ws._side];
          if (me) me.ready = true;
          if (match.players.every(p => p.ready)) beginCountdown(match);
          break;
        }
        case 'state': {
          if (!match || !match.started) break;
          const me = match.players[ws._side];
          if (me) me.score = Math.max(me.score, Math.floor(msg.score || 0));
          // relay this player's state to the opponent
          const opp = opponentOf(match, ws._side);
          send(opp.ws, {
            t: 'opp', y: msg.y, vy: msg.vy, rot: msg.rot,
            score: Math.floor(msg.score || 0), alive: true,
          });
          break;
        }
        case 'dead': {
          if (!match) break;
          const me = match.players[ws._side];
          if (me) { me.alive = false; me.score = Math.max(me.score, Math.floor(msg.score || 0)); }
          const opp = opponentOf(match, ws._side);
          send(opp.ws, { t: 'opp', alive: false, score: me ? me.score : 0 });
          maybeFinish(match);
          break;
        }
        case 'leave': {
          cleanup(ws, 'left');
          break;
        }
      }
    });

    ws.on('close', () => cleanup(ws, 'closed'));
    ws.on('error', () => cleanup(ws, 'error'));
  });

  // heartbeat: drop dead connections
  const hb = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, 30000);
  wss.on('close', () => clearInterval(hb));

  function cleanup(ws, why) {
    // remove from queue
    const qi = QUEUE.indexOf(ws);
    if (qi >= 0) QUEUE.splice(qi, 1);
    // if in a match, the opponent wins by forfeit
    const match = ws._matchId ? MATCHES.get(ws._matchId) : null;
    if (match && !match.ended) {
      const opp = opponentOf(match, ws._side);
      send(opp.ws, { t: 'oppLeft' });
      endMatch(match, ws._side === 0 ? 'left0' : 'left1');
    }
    ws._matchId = null;
    broadcastStats(wss);   // someone left → update counts
  }

  console.log('[mp] multiplayer WebSocket server attached at /ws');
  return wss;
}

