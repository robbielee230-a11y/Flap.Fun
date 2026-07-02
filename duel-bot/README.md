# duel-bot

A Playwright bot that logs into a betting site and places **duel** bets for you,
with a configurable strategy and hard safety guardrails. It is **config-driven**:
you adapt it to a specific site by editing selectors/URLs in `config.js` (or via
env vars) — you don't touch the bot logic.

> ⚠️ **Read this first.** Automating bets almost always violates a gambling
> site's Terms of Service and can get your account banned or funds frozen. Only
> automate your own account, with money you can afford to lose. This tool defaults
> to `DRY_RUN=true` (simulate, never click final confirm). You own the risk.

## Setup

```bash
cd duel-bot
npm install                 # also installs the Chromium browser
cp .env.example .env        # then edit .env
```

Edit `.env`:
- `SITE_URL`, `LOGIN_URL`, `DUEL_URL` — the site you're targeting.
- Selectors (`SEL_*`) — tune these to the real page (Inspect element in the
  browser). Defaults are generic guesses and almost certainly need changing.
- Guardrails — `STAKE`, `MAX_STAKE`, `MAX_BETS`, `STOP_LOSS`, `TAKE_PROFIT`.

## Usage

```bash
# 1. Log in once (opens a real window so you can solve 2FA/captcha by hand).
#    The session is saved to .auth/state.json so you don't log in every run.
HEADLESS=false npm run login

# 2. Dry run — does everything except the final "confirm" click. Watch it work.
npm run dry

# 3. Go live — only after the dry run behaves. Flip DRY_RUN=false in .env.
npm start
```

## How it works

| File | Responsibility |
|------|----------------|
| `config.js` | URLs, credentials, strategy params, **selectors** (the site-specific part) |
| `src/browser.js` | Launch Chromium, persist/restore the logged-in session |
| `src/login.js` | Log in (or verify saved session); pauses for manual 2FA/captcha |
| `src/strategy.js` | Stake sizing + hard stops (loss/profit/bet-count) |
| `src/bot.js` | The bet loop: read balance → pick stake → place duel bet → track P&L |
| `src/index.js` | Entry point / CLI |

## Tuning selectors

The only fragile part is the selectors. To find good ones:
1. Run `HEADLESS=false npm run dry` and watch where it fails.
2. Right-click the element it couldn't find → **Inspect**.
3. Prefer stable selectors: `getByRole`, visible text (`button:has-text("Duel")`),
   or `data-*` attributes over long CSS class chains.
4. Override in `.env`, e.g. `SEL_DUEL_BTN='button:has-text("Start Duel")'`.

## Changing the betting strategy

Edit `src/strategy.js`. `nextStake(history)` returns the stake for the next bet;
`history` holds `{stake, delta}` for prior bets, so you can implement
streak-based or martingale sizing. `MAX_STAKE` is always enforced on top.
