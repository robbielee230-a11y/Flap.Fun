// Sportsbook betting flow for duel.com.
//
// duel.com's sportsbook is BetBy, rendered inside an <iframe> via the BTRenderer
// SDK. That means the search box, event list, odds buttons and bet slip all live
// INSIDE the iframe, so we drive them through a Playwright frame locator rather
// than the top-level page.
//
// Because BetBy's DOM is obfuscated and operator-specific, the selectors in
// config.js are best-effort defaults. Run `npm run inspect` on a logged-in
// session to capture the real ones, then set the SEL_SB_* env vars.
import { CONFIG } from '../config.js';
import { validateStake, shouldStop, nextStake } from './strategy.js';
import { log } from './logger.js';

const S = CONFIG.selectors;
const T = CONFIG.target;
const { dryRun, betIntervalMs } = CONFIG.strategy;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Return a FrameLocator for the BetBy iframe, waited until it's attached.
export async function getBetbyFrame(page) {
  const iframe = page.locator(S.betbyIframe).first();
  await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  return page.frameLocator(S.betbyIframe);
}

// Find the target event/selection inside BetBy and add it to the bet slip.
async function selectMarket(frame) {
  if (T.search) {
    const search = frame.locator(S.sbSearchInput).first();
    if (await search.count()) {
      await search.fill(T.search);
      await sleep(1500); // let results load
    }
  }

  // Prefer clicking an explicit selection by its text (most stable). Fall back
  // to the first odds button matching the configured selector.
  if (T.selection) {
    const byText = frame.getByText(T.selection, { exact: false }).first();
    await byText.click({ timeout: 15_000 });
  } else {
    await frame.locator(S.sbOddsButton).first().click({ timeout: 15_000 });
  }
  log.bet(`Added selection to slip (search="${T.search}", selection="${T.selection || 'first odds'}").`);
}

// Place ONE sports bet at the given stake. Returns { placed }.
async function placeOneBet(frame, stake) {
  validateStake(stake);
  await selectMarket(frame);

  const stakeInput = frame.locator(S.sbStakeInput).first();
  await stakeInput.waitFor({ state: 'visible', timeout: 15_000 });
  await stakeInput.fill(String(stake));

  if (dryRun) {
    log.bet(`DRY_RUN: bet slip armed with stake ${stake}. NOT clicking place-bet.`);
    return { placed: false };
  }

  await frame.locator(S.sbPlaceBetButton).first().click({ timeout: 15_000 });
  // Some slips show a secondary confirm; click it if present.
  const confirm = frame.locator(S.sbConfirmButton).first();
  if (await confirm.count().catch(() => 0)) {
    await confirm.click({ timeout: 8_000 }).catch(() => {});
  }
  log.bet(`Placed sports bet of ${stake}.`);
  return { placed: true };
}

export async function run(page) {
  await page.goto(CONFIG.urls.sportsbook, { waitUntil: 'domcontentloaded' });
  const frame = await getBetbyFrame(page);
  log.info('BetBy sportsbook frame located.');

  const history = [];
  let betsPlaced = 0;
  let netPnl = 0; // NOTE: sports bets settle later, so realized P&L isn't read here.

  while (true) {
    const stop = shouldStop({ betsPlaced, netPnl });
    if (stop) {
      log.info(`Stopping: ${stop}.`);
      break;
    }

    const stake = nextStake(history);
    let result;
    try {
      result = await placeOneBet(frame, stake);
    } catch (e) {
      log.error(`Bet failed: ${e.message}. Stopping to be safe.`);
      break;
    }
    betsPlaced++;
    history.push({ stake, delta: 0 });
    await sleep(betIntervalMs);
  }

  log.info(`Done. Bets ${dryRun ? 'simulated' : 'placed'}: ${betsPlaced}.`);
  return { betsPlaced };
}
