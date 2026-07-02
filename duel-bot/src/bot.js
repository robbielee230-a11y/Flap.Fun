// The betting loop: read balance -> pick stake -> place a duel bet -> track P&L,
// respecting all guardrails. In DRY_RUN it does everything EXCEPT the final
// confirm click, so you can watch it work with zero money at risk.
import { CONFIG } from '../config.js';
import { nextStake, shouldStop, validateStake } from './strategy.js';
import { log } from './logger.js';

const S = CONFIG.selectors;
const { dryRun, betIntervalMs } = CONFIG.strategy;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse a number out of a balance string like "$1,234.50" or "1234 coins".
async function readBalance(page) {
  try {
    const txt = await page.textContent(S.balanceText, { timeout: 5000 });
    const n = Number(String(txt).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Place ONE bet. Returns { placed, stake }.
async function placeOneBet(page, stake) {
  validateStake(stake);

  // Open the duel, set the stake, arm the bet.
  await page.click(S.duelButton);
  await page.fill(S.stakeInput, String(stake));
  await page.click(S.placeBetButton);

  if (dryRun) {
    log.bet(`DRY_RUN: would confirm bet of ${stake}. Skipping confirm click.`);
    // Try to back out of any confirm dialog so we return to a clean state.
    await page.keyboard.press('Escape').catch(() => {});
    return { placed: false, stake };
  }

  await page.click(S.confirmButton);
  log.bet(`Placed bet of ${stake}.`);
  return { placed: true, stake };
}

export async function run(page) {
  const history = [];
  let betsPlaced = 0;
  let netPnl = 0;

  const startBalance = await readBalance(page);
  log.money(`Starting balance: ${startBalance ?? 'unknown'}${dryRun ? '  (DRY_RUN)' : ''}`);

  while (true) {
    const stop = shouldStop({ betsPlaced, netPnl });
    if (stop) {
      log.info(`Stopping: ${stop}.`);
      break;
    }

    const stake = nextStake(history);
    const before = await readBalance(page);

    let result;
    try {
      result = await placeOneBet(page, stake);
    } catch (e) {
      log.error(`Bet failed: ${e.message}. Stopping to be safe.`);
      break;
    }

    if (result.placed) {
      betsPlaced++;
      // Let the duel resolve, then measure the balance delta as realized P&L.
      await sleep(betIntervalMs);
      const after = await readBalance(page);
      const delta = before != null && after != null ? after - before : 0;
      netPnl += delta;
      history.push({ stake, delta });
      log.money(`Bet #${betsPlaced}: stake ${stake}, delta ${delta}, net ${netPnl}.`);
    } else {
      // DRY_RUN: nothing was risked; just pace ourselves and stop after maxBets.
      betsPlaced++;
      history.push({ stake, delta: 0 });
    }

    await sleep(betIntervalMs);
  }

  const endBalance = await readBalance(page);
  log.money(
    `Done. Bets: ${betsPlaced}, net P&L: ${netPnl}, ` +
      `balance ${startBalance ?? '?'} -> ${endBalance ?? '?'}${dryRun ? '  (DRY_RUN)' : ''}`
  );
  return { betsPlaced, netPnl };
}
