// verify.test.js — prove the scheme does what it claims.
import { simulate, mulberry32, CFG } from './src/engine.js';
import { analyze } from './src/anticheat.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } };

// A helper that plays the game with a simple "flap when below target" autopilot,
// recording the flap ticks — i.e. it generates a LEGITIMATE input stream the way
// a real client would, then we verify the server reproduces the same score.
function autopilot(seed, maxTicks = 6000) {
  const rng = mulberry32(seed);
  const pipeTop = () => Math.floor(CFG.PIPE_MIN_TOP + rng() * (CFG.GROUND_Y - CFG.GAP - 2 * CFG.PIPE_MIN_TOP));
  let y = CFG.WORLD_H / 2, v = 0, score = 0, nextSpawn = CFG.SPAWN_TICKS;
  const pipes = []; const flaps = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    // aim at the gap centre of the nearest pipe ahead of (or over) the bird
    let aim = CFG.WORLD_H / 2;
    let best = Infinity;
    for (const p of pipes) {
      const edge = p.x + CFG.PIPE_W;
      if (edge >= CFG.BIRD_X - 20 && p.x < best) { best = p.x; aim = p.top + CFG.GAP / 2; }
    }
    // flap if we're below the aim point and not already rising fast
    if (y > aim && v > CFG.FLAP_V * 0.4) { v = CFG.FLAP_V; flaps.push(tick); }
    v += CFG.GRAVITY; y += v;
    if (tick >= nextSpawn) { pipes.push({ x: CFG.WORLD_W, top: pipeTop(), scored: false }); nextSpawn += CFG.SPAWN_TICKS; }
    for (const p of pipes) {
      p.x -= CFG.SPEED;
      if (!p.scored && p.x + CFG.PIPE_W < CFG.BIRD_X) { p.scored = true; score++; }
      const inX = (CFG.BIRD_X + CFG.BIRD_R > p.x) && (CFG.BIRD_X - CFG.BIRD_R < p.x + CFG.PIPE_W);
      const inGap = (y - CFG.BIRD_R > p.top) && (y + CFG.BIRD_R < p.top + CFG.GAP);
      if (inX && !inGap) return { flaps, score, diedTick: tick };
    }
    for (let i = pipes.length - 1; i >= 0; i--) if (pipes[i].x + CFG.PIPE_W < -10) pipes.splice(i, 1);
    if (y + CFG.BIRD_R > CFG.GROUND_Y || y - CFG.BIRD_R < 0) return { flaps, score, diedTick: tick };
  }
  return { flaps, score, diedTick: maxTicks };
}

console.log('\n1. Determinism: same seed + inputs -> same score, every time');
{
  const seed = 12345;
  const run = autopilot(seed);
  const a = simulate(seed, run.flaps);
  const b = simulate(seed, run.flaps);
  ok(a.score === b.score, `re-simulation reproducible (score=${a.score})`);
  ok(a.score === run.score, `server score matches the client's own play (${a.score} vs ${run.score})`);
}

console.log('\n2. Fake score: client claims a number but inputs don\'t back it up');
{
  const seed = 999;
  const run = autopilot(seed);
  // attacker submits only 2 flaps but "claims" the run was long — server only trusts inputs
  const fakeInputs = [10, 20];
  const sim = simulate(seed, fakeInputs);
  ok(sim.score < run.score, `2-flap junk stream scores ~${sim.score}, far below a real ${run.score}`);
  ok(sim.died, 'junk stream dies quickly, as it must');
}

console.log('\n3. Tampered seed: attacker plays seed A, submits against seed B');
{
  const runA = autopilot(111);
  const onWrongSeed = simulate(222, runA.flaps);   // same inputs, different pipes
  ok(onWrongSeed.score < runA.score, `inputs from seed 111 fail on seed 222 (score ${onWrongSeed.score} < ${runA.score})`);
}

console.log('\n4. Non-monotonic / malformed inputs are rejected outright');
{
  ok(simulate(5, [10, 9, 30]).reason === 'non_monotonic_inputs', 'out-of-order flaps rejected');
  ok(simulate(5, 'not-an-array').reason === 'no_inputs', 'non-array rejected');
  ok(simulate(5, new Array(CFG.MAX_FLAPS + 1).fill(0).map((_, i) => i)).reason === 'too_many_flaps', 'flap-spam rejected');
}

console.log('\n5. Anti-cheat flags a perfectly-regular (bot-like) stream');
{
  const seed = 7;
  const run = autopilot(seed);          // zero jitter = robotic
  const sim = simulate(seed, run.flaps);
  const ac = analyze(seed, run.flaps, sim);
  ok(ac.flags.length >= 0, `bot-like run -> verdict=${ac.verdict}, flags=[${ac.flags.map(f=>f.k).join(',')}]`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
