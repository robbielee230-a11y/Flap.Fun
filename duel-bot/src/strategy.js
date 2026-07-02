// Betting strategy + guardrails. Keep the risk logic separate from the browser
// driving so you can change how you bet without touching Playwright code.
import { CONFIG } from '../config.js';

const { stake, maxStake, maxBets, stopLoss, takeProfit } = CONFIG.strategy;

// Decide the stake for the next bet.
// Default: flat staking. `history` is an array of {stake, delta} outcomes so far,
// so you can implement martingale / streak-based sizing here if you want.
export function nextStake(history) {
  // --- flat staking (default, safest) ---
  let s = stake;

  // --- example martingale (commented out): double after a loss ---
  // const last = history[history.length - 1];
  // if (last && last.delta < 0) s = Math.min(last.stake * 2, maxStake);

  return Math.min(s, maxStake);
}

// Hard stop checks — called before every bet. Returns a reason string to stop,
// or null to keep going.
export function shouldStop({ betsPlaced, netPnl }) {
  if (betsPlaced >= maxBets) return `reached MAX_BETS (${maxBets})`;
  if (netPnl <= -Math.abs(stopLoss)) return `hit STOP_LOSS (net ${netPnl})`;
  if (netPnl >= Math.abs(takeProfit)) return `hit TAKE_PROFIT (net ${netPnl})`;
  return null;
}

export function validateStake(s) {
  if (!(s > 0)) throw new Error(`invalid stake ${s}`);
  if (s > maxStake) throw new Error(`stake ${s} exceeds MAX_STAKE ${maxStake}`);
  return true;
}
