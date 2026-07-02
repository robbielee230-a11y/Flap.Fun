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
    site: process.env.SITE_URL || 'https://example-duel-site.com',
    login: process.env.LOGIN_URL || 'https://example-duel-site.com/login',
    duel: process.env.DUEL_URL || 'https://example-duel-site.com/duel',
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
  // SELECTORS — the only part you MUST tune to your actual site.
  // Right-click an element in the browser -> Inspect to find good selectors.
  // Prefer getByRole / text / data-* attributes over brittle CSS class chains.
  // You can override any of these with an env var of the same UPPER_SNAKE name.
  // ---------------------------------------------------------------------------
  selectors: {
    // Login page
    usernameInput: process.env.SEL_USERNAME || 'input[name="username"], input[type="email"]',
    passwordInput: process.env.SEL_PASSWORD || 'input[name="password"], input[type="password"]',
    loginButton: process.env.SEL_LOGIN_BTN || 'button[type="submit"]',
    // A selector that only exists AFTER a successful login (used to confirm auth)
    loggedInMarker: process.env.SEL_LOGGED_IN || '[data-testid="user-balance"], .account-balance',

    // Duel / betting page
    duelButton: process.env.SEL_DUEL_BTN || 'button:has-text("Duel")',
    stakeInput: process.env.SEL_STAKE_INPUT || 'input[name="amount"], input[name="stake"]',
    placeBetButton: process.env.SEL_PLACE_BTN || 'button:has-text("Place Bet")',
    // Final confirm dialog button (the click we skip in DRY_RUN)
    confirmButton: process.env.SEL_CONFIRM_BTN || 'button:has-text("Confirm")',
    // Where the current balance is displayed (used for P&L tracking)
    balanceText: process.env.SEL_BALANCE || '[data-testid="user-balance"], .account-balance',
    // Optional: result/outcome banner after a duel resolves
    resultText: process.env.SEL_RESULT || '.duel-result, [data-testid="duel-result"]',
  },
};
