# duel-bot

Playwright automation for the **duel.com sportsbook** (e.g. ITF tennis). Logs in,
opens the sportsbook, finds your event, and places a bet — with hard safety
guardrails and a dry-run default.

> ⚠️ **Read this.** Automating bets violates most sportsbooks' Terms of Service
> and can get your account/funds frozen. Automate only your own account, with
> money you can lose. Defaults to `DRY_RUN=true` (arms the bet slip, never places).
> You own the risk.

## How duel.com's sportsbook actually works (important)

I read duel.com's JavaScript to map this out:

- **Login is a modal** on the homepage (`AuthModal`), not a `/login` page. The bot
  clicks a "Sign in" button to open it.
- **The sportsbook is [BetBy](https://betby.com)**, a third-party provider. duel.com
  fetches a BetBy JWT from `api/v2/match-betting/betby` and boots the widget with
  `new BTRenderer().initialize({ brand_id, token, ... })`.
- **Everything you bet on lives inside a BetBy `<iframe>`** — the search box, the
  event list, the odds buttons, and the bet slip. So the bot drives that *frame*,
  not the top-level page (see `src/sportsbook.js`, `page.frameLocator`).
- BetBy's markup is **obfuscated and operator-specific**, so there are no clean
  `data-testid`s. Prefer **text-based** locators and capture the working ones on a
  live session with `npm run inspect`.

## Setup

```bash
cd duel-bot
npm install                 # installs Playwright + Chromium
cp .env.example .env        # then edit
```

## Usage

```bash
# 1. Log in once, in a real window (solve any Cloudflare/2FA by hand).
#    Session is saved to .auth/state.json so later runs skip login.
HEADLESS=false npm run login

# 2. Capture the real selectors from inside the BetBy iframe.
#    Prints the frames + the buttons/inputs inside BetBy. Copy the good ones
#    into .env as SEL_SB_* (and SEL_BETBY_IFRAME if the default doesn't match).
HEADLESS=false npm run inspect

# 3. Dry run — searches your event, arms the bet slip, but never places.
npm run dry

# 4. Go live — only after the dry run behaves. Set DRY_RUN=false in .env.
npm start
```

## Files

| File | Responsibility |
|------|----------------|
| `config.js` | URLs, target event, guardrails, selectors (page + BetBy-iframe) |
| `src/browser.js` | Launch Chromium, persist/restore the logged-in session |
| `src/login.js` | Open the login modal, sign in (or reuse saved session) |
| `src/inspect.js` | Dump frames + BetBy iframe elements to capture selectors |
| `src/sportsbook.js` | Locate the BetBy frame → search event → add to slip → stake → place |
| `src/strategy.js` | Stake sizing + hard stops (bet count / loss / profit) |
| `src/index.js` | Entry / CLI (`--login-only`, `--inspect`) |

## Why "just clicking" is the fragile part

Because the sportsbook is a BetBy widget in an iframe, UI automation has to reach
into that frame and click obfuscated elements that can change without notice. Two
implications:

1. **Expect to re-capture selectors** with `npm run inspect` when BetBy updates.
2. For anything **odds-sensitive (e.g. arbitrage across books)**, reading prices
   out of the BetBy widget and reacting fast enough by clicking is unreliable.
   Pulling odds from an API-backed venue (Kalshi/Polymarket both have official
   APIs) on one side and using this bot only for placement is a more robust shape.

## Strategy

Edit `src/strategy.js`. `nextStake(history)` returns the next stake (`history` holds
past `{stake, delta}`); `MAX_STAKE` is always enforced. Note sports bets settle
later, so realized P&L isn't read back in-run — `STOP_LOSS`/`TAKE_PROFIT` are
wired but only meaningful once you feed settlement data in.
