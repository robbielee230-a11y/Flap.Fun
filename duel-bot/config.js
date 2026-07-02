// Central config. Everything site-specific lives here so you adapt the bot to a
// given "duel" site by editing SELECTORS + URLs, not the bot logic.
// Load .env if dotenv is available; fall back to raw process.env otherwise.
try {
  await import('dotenv/config');
} catch {
  // dotenv not installed — env vars must be set in the shell.
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

export const CONFIG = {
  urls: {
    site: process.env.SITE_URL || 'https://duel.com',
    // duel.com logs in via a MODAL, not a page. We open the site and click the
    // login button (see selectors.openLoginButton) rather than visiting a URL.
    login: process.env.LOGIN_URL || 'https://duel.com',
    // The sportsbook route. duel.com renders BetBy here. Confirm the exact path
    // in your browser (e.g. /sports or /sportsbook) and set SPORTSBOOK_URL.
    sportsbook: process.env.SPORTSBOOK_URL || 'https://duel.com/sports',
  },
  // What event to bet on. Used to search/filter inside the BetBy widget.
  target: {
    // free-text search term typed into BetBy's search (e.g. a player name)
    search: process.env.EVENT_SEARCH || 'ITF',
    // the exact market/selection text to click (e.g. a player's name to back)
    selection: process.env.SELECTION_TEXT || '',
  },
  creds: {
    username: process.env.DUEL_USERNAME || '',
    password: process.env.DUEL_PASSWORD || '',
  },
  strategy: {
    dryRun: bool(process.env.DRY_RUN, true),
    stake: num(process.env.STAKE, 1),
    maxStake: num(process.env.MAX_STAKE, 5),
    maxBets: num(process.env.MAX_BETS, 10),
    stopLoss: num(process.env.STOP_LOSS, 25),
    takeProfit: num(process.env.TAKE_PROFIT, 50),
    betIntervalMs: num(process.env.BET_INTERVAL_MS, 4000),
  },
  browser: {
    headless: bool(process.env.HEADLESS, false),
    storageState: process.env.STORAGE_STATE || './.auth/state.json',
  },

  // ---------------------------------------------------------------------------
  // SELECTORS — the part you MUST tune on a live logged-in session.
  //
  // Two DOM worlds here:
  //   (a) duel.com's own page — login modal, balance, the sportsbook container.
  //   (b) the BetBy iframe — the whole sportsbook: search, events, odds, bet
  //       slip, place-bet button. These render INSIDE an <iframe>, so the bot
  //       reaches them via a frame locator (see src/sportsbook.js). BetBy's
  //       markup is obfuscated, so prefer text-based locators (getByText /
  //       has-text) over class names, and CAPTURE the working ones locally with
  //       `npm run inspect`.
  //
  // Override any of these with an env var of the same UPPER_SNAKE name.
  // ---------------------------------------------------------------------------
  selectors: {
    // --- (a) duel.com page ---
    // Button that opens the login/auth modal
    openLoginButton: process.env.SEL_OPEN_LOGIN || 'button:has-text("Sign in"), button:has-text("Log in")',
    usernameInput: process.env.SEL_USERNAME || 'input[name="username"], input[type="email"], input[name="email"]',
    passwordInput: process.env.SEL_PASSWORD || 'input[type="password"]',
    loginButton: process.env.SEL_LOGIN_BTN || 'button[type="submit"]',
    // A selector that only exists AFTER a successful login (confirms auth).
    // On duel.com the balance/wallet area is a good marker — set precisely.
    loggedInMarker: process.env.SEL_LOGGED_IN || '[href*="wallet"], [data-cp-id]',
    balanceText: process.env.SEL_BALANCE || '[data-balance], .balance',

    // The <iframe> BetBy renders into. Confirm its src substring via `npm run
    // inspect` — often contains "betby" or an sdk host. Used to get the frame.
    betbyIframe: process.env.SEL_BETBY_IFRAME || 'iframe[src*="betby"], iframe[id*="betby"], iframe[src*="sptpub"]',

    // --- (b) inside the BetBy iframe (capture these locally!) ---
    sbSearchInput: process.env.SEL_SB_SEARCH || 'input[type="search"], input[placeholder*="Search" i]',
    // Clicking an odds/price button adds the selection to the bet slip.
    sbOddsButton: process.env.SEL_SB_ODDS || '[class*="outcome"], [class*="odd"]',
    // Bet slip stake input + place button
    sbStakeInput: process.env.SEL_SB_STAKE || 'input[inputmode="decimal"], input[type="number"]',
    sbPlaceBetButton: process.env.SEL_SB_PLACE || 'button:has-text("Place bet"), button:has-text("Bet")',
    // Confirmation inside the slip, if any (the click skipped in DRY_RUN)
    sbConfirmButton: process.env.SEL_SB_CONFIRM || 'button:has-text("Confirm")',
  },
};
