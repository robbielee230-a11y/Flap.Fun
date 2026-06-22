# FLAPP — deploy to a public link

Goal: a URL anyone can click to play, with one shared server-verified leaderboard.

This bundles the front-end and the server together, so you deploy **one service**.
(You can split them later; bundled is simplest to launch.)

---

## What you're deploying

```
 player's browser
        │   https://your-app.up.railway.app
        ▼
 ┌─────────────────────────┐
 │  Railway service        │
 │   node server.js        │  ← serves the game AND verifies runs
 │   + Postgres addon      │  ← shared leaderboard, survives restarts
 └─────────────────────────┘
```

---

## Step 1 — put the code on GitHub

```bash
cd flapp-deploy
git init && git add . && git commit -m "FLAPP verified leaderboard"
# create an empty repo on github.com, then:
git remote add origin https://github.com/YOU/flapp.git
git push -u origin main
```

## Step 2 — deploy on Railway

1. Go to railway.app, **New Project → Deploy from GitHub repo**, pick your repo.
2. Railway detects Node and runs `node server.js` (from `railway.json`).
3. **Add a database:** in the project, **New → Database → PostgreSQL**. Railway
   automatically injects `DATABASE_URL` into your service. The server picks it up
   and creates its tables on first boot — nothing else to do.
4. **Set env vars** (service → Variables):
   - `SESSION_SECRET` → a long random string. Generate one:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `ALLOWED_ORIGIN` → your Railway URL once you know it (e.g.
     `https://flapp-production.up.railway.app`). Set to `*` for the first deploy,
     then tighten.
   - Leave `REQUIRE_WALLET=0` for now (handle-based test version).
5. Railway gives you a public URL. **That's your link.** Open it — you're playing.

## Step 3 — share it

Send the URL to your mate. You both open it, pick handles, play. Scores are
re-simulated server-side and the board syncs live for everyone connected.

For a custom domain (flappgame.xyz): Railway → Settings → Networking → Custom
Domain, then point your DNS. Update `ALLOWED_ORIGIN` to match.

---

## Render / Fly.io instead of Railway

Same shape: connect the repo, add managed Postgres (sets `DATABASE_URL`), set
`SESSION_SECRET` and `ALLOWED_ORIGIN`, deploy. The code is host-agnostic.

---

## Cost

Railway/Render free tiers cover early testing. A live always-on service with
Postgres is ~$5–10/mo. That's the real cost of "always available at a link" — a
shared board can't be free-static like a single HTML file, because something has
to hold the board and verify runs 24/7.

---

## Local dev (no database needed)

```bash
npm install
SESSION_SECRET=dev-secret node server.js
# open http://localhost:8787  — uses in-memory store, resets on restart
```

---

## ⚠️ Before this carries real money — unchanged from README

Hosting makes it *public*. It does not make a real-money pot *safe* or *legal*.
A public link reaches everyone, everywhere, which raises the stakes on every gap:

- **Turn on wallet auth** (`REQUIRE_WALLET=1`) so scores tie to a real wallet, and
  add the on-chain hold-gate eligibility check (stubbed in server.js).
- **Tune bot-detection** (anticheat.js) on real human play before any prize rides on it.
- **Geo-fence + terms.** A public URL serves jurisdictions where a paid prize pool
  may be illegal. This is part of "can this link legally exist," per the specific
  conditions your lawyer gave you — not optional polish.
- **Payouts sign server-side** from a hot wallet with minimal balance + a manual
  circuit-breaker. Never in the client.

Deploy the game now. Keep the pot mocked. Wire real value only after the above.
