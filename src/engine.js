// ============================================================================
// engine.js — DETERMINISTIC Flappy simulation
// This exact file runs on BOTH the client and the server. The whole anti-cheat
// scheme depends on it producing byte-identical results in both places.
//
// Rules that keep it deterministic:
//  - integer/float math only, no Date.now(), no Math.random() (we use a seeded PRNG)
//  - fixed timestep: physics advance in whole ticks, never wall-clock frames
//  - pipes generated from the seed, so client can't precompute and server can reproduce
// ============================================================================

// ---- tunables: MUST be identical client & server. Change in one place only. ----
export const CFG = Object.freeze({
  TICK_MS:      16,      // fixed simulation step (ms). ~60Hz. Never use real frame time.
  GRAVITY:      0.42,    // velocity gain per tick
  FLAP_V:      -7.2,     // velocity set on a flap
  WORLD_W:      380,
  WORLD_H:      560,
  GROUND_Y:     510,     // WORLD_H - 50
  BIRD_X:       110,
  BIRD_R:       12,
  PIPE_W:       58,
  GAP:          140,
  SPEED:        2.1,     // pipe scroll per tick
  SPAWN_TICKS:  95,      // ticks between pipe spawns
  PIPE_MIN_TOP: 70,
  MAX_TICKS:    60000,   // hard cap (~16 min) — rejects absurd runs
  MAX_FLAPS:    5000,    // a human can't flap more than this in a sane run
});

// ---- deterministic PRNG: mulberry32. Same seed -> same sequence everywhere. ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pipe top-edge for the Nth pipe, derived purely from seed. Pure function.
function pipeTopFor(rng) {
  const min = CFG.PIPE_MIN_TOP;
  const max = CFG.GROUND_Y - CFG.GAP - CFG.PIPE_MIN_TOP;
  return Math.floor(min + rng() * (max - min));
}

// ============================================================================
// simulate(seed, flapTicks) -> { score, ticks, died, reason }
//
//   seed       : uint32 issued by the server at run start
//   flapTicks  : array of integer tick indices at which the player flapped,
//                strictly increasing. THIS is what the client submits.
//
// The function replays the entire run. The score it returns is authoritative.
// ============================================================================
export function simulate(seed, flapTicks) {
  // ---- validate inputs cheaply before doing work ----
  if (!Array.isArray(flapTicks)) return { score: 0, ticks: 0, died: true, reason: 'no_inputs' };
  if (flapTicks.length > CFG.MAX_FLAPS) return { score: 0, ticks: 0, died: true, reason: 'too_many_flaps' };
  for (let i = 1; i < flapTicks.length; i++) {
    if (!Number.isInteger(flapTicks[i]) || flapTicks[i] <= flapTicks[i - 1]) {
      return { score: 0, ticks: 0, died: true, reason: 'non_monotonic_inputs' };
    }
  }

  const rng = mulberry32(seed);
  let birdY = CFG.WORLD_H / 2;
  let birdV = 0;
  let score = 0;
  let nextSpawn = CFG.SPAWN_TICKS;
  let flapIdx = 0;

  // pipes in flight: {x, top, scored}
  const pipes = [];

  for (let tick = 0; tick < CFG.MAX_TICKS; tick++) {
    // apply any flaps scheduled for this tick
    while (flapIdx < flapTicks.length && flapTicks[flapIdx] === tick) {
      birdV = CFG.FLAP_V;
      flapIdx++;
    }

    // physics
    birdV += CFG.GRAVITY;
    birdY += birdV;

    // spawn
    if (tick >= nextSpawn) {
      pipes.push({ x: CFG.WORLD_W, top: pipeTopFor(rng), scored: false });
      nextSpawn += CFG.SPAWN_TICKS;
    }

    // move pipes, score, collide
    for (const p of pipes) {
      p.x -= CFG.SPEED;
      if (!p.scored && p.x + CFG.PIPE_W < CFG.BIRD_X) { p.scored = true; score++; }
      const inX = (CFG.BIRD_X + CFG.BIRD_R > p.x) && (CFG.BIRD_X - CFG.BIRD_R < p.x + CFG.PIPE_W);
      const inGap = (birdY - CFG.BIRD_R > p.top) && (birdY + CFG.BIRD_R < p.top + CFG.GAP);
      if (inX && !inGap) return { score, ticks: tick, died: true, reason: 'pipe' };
    }
    // cull offscreen
    for (let i = pipes.length - 1; i >= 0; i--) if (pipes[i].x + CFG.PIPE_W < -10) pipes.splice(i, 1);

    // ground / ceiling
    if (birdY + CFG.BIRD_R > CFG.GROUND_Y || birdY - CFG.BIRD_R < 0) {
      return { score, ticks: tick, died: true, reason: 'bounds' };
    }

    // run consumed all inputs and bird is still alive past last flap with no pipes left to clear?
    // we keep simulating until death; an honest client stops sending input at death.
    if (flapIdx >= flapTicks.length && tick > (flapTicks[flapTicks.length - 1] || 0) + 2000) {
      // no more inputs for ~32s of sim — treat as abandoned, score stands
      return { score, ticks: tick, died: true, reason: 'idle_end' };
    }
  }
  return { score, ticks: CFG.MAX_TICKS, died: true, reason: 'max_ticks' };
}
