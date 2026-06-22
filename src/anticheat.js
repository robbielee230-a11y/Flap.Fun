// ============================================================================
// anticheat.js — heuristics over a verified run.
//
// simulate() proves the inputs PRODUCE the claimed score. That stops fake
// numbers. It does NOT stop a bot that plays perfectly. These heuristics raise
// the cost of botting by flagging inhuman input signatures. None is a proof;
// they produce a suspicion score. Tune thresholds against real human data.
// ============================================================================

import { CFG } from './engine.js';

export function analyze(seed, flapTicks, sim) {
  const flags = [];
  const n = flapTicks.length;

  // gaps between consecutive flaps, in ticks
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(flapTicks[i] - flapTicks[i - 1]);

  // 1) reaction-time flatness: humans have jittery inter-flap timing.
  //    A bot reacting to pipe position tends to cluster gaps tightly.
  if (gaps.length >= 8) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / (mean || 1);     // coefficient of variation
    if (cv < 0.12) flags.push({ k: 'low_timing_jitter', cv: +cv.toFixed(3) });
  }

  // 2) superhuman tap rate: flaps closer than ~80ms (5 ticks) repeatedly.
  const fastTaps = gaps.filter(g => g < 5).length;
  if (fastTaps > Math.max(3, n * 0.10)) flags.push({ k: 'superhuman_taprate', fastTaps });

  // 3) frame-perfect survival: extremely long run with near-zero timing spread
  //    late in the run (bots don't fatigue).
  if (sim.score > 40 && gaps.length > 30) {
    const tail = gaps.slice(-20);
    const tMean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const tVar = tail.reduce((a, b) => a + (b - tMean) ** 2, 0) / tail.length;
    if (Math.sqrt(tVar) < 0.8) flags.push({ k: 'no_late_game_drift' });
  }

  // 4) impossible score/tick ratio sanity (already simulated, but cross-check)
  const expectedMinTicks = sim.score * CFG.SPAWN_TICKS * 0.5;
  if (sim.ticks < expectedMinTicks) flags.push({ k: 'score_tick_mismatch' });

  // suspicion: 0 clean, higher = more bot-like
  const suspicion = flags.length;
  return { suspicion, flags, verdict: suspicion === 0 ? 'pass' : suspicion >= 2 ? 'reject' : 'review' };
}
