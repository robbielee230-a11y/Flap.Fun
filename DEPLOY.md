# Flap.Fun — Deploy Guide (1v1 multiplayer + leaderboard)

This package contains BOTH the game and the backend in one. When deployed,
one Railway service serves the game AND runs multiplayer + leaderboard at the
SAME URL. No second service needed.

## What changed (why your old deploy didn't have multiplayer)
- The old root `server.js` was a prototype with NO multiplayer and broken
  imports. It's been replaced with one that launches the real backend.
- The real backend (`src/server.js`) now ALSO serves the game from `public/`.
- The game (`public/index.html`) auto-connects to its own URL — no config.

## How to deploy (replace your whole repo with these files)

1. On GitHub, open your repo `Flap.Fun`.
2. EASIEST: delete the old files and upload these. OR use the web upload:
   - Click "Add file" -> "Upload files"
   - Drag in ALL files/folders from this package (server.js, package.json,
     railway.json, src/, public/, etc.)
   - It will overwrite files with the same name. Commit.
3. Railway auto-redeploys on the commit.

## Railway settings (one-time)
Open your Flap.Fun SERVICE -> Variables tab. Make sure these exist:

- `DATABASE_URL`  -> should already be there (injected by your Postgres plugin).
                     If not: in the Postgres service, copy its connection URL.
- `JWT_SECRET`    -> set to any long random string (e.g. run `openssl rand -hex 32`).
- `ALLOWED_ORIGINS` -> set to `*` to start (tighten later to your game URL).

Leave `TOKEN_MINT` empty (disables wallet/token gating — multiplayer + board
still work fully without it). `PORT` is auto-injected by Railway; don't set it.

## Verify it worked
1. After redeploy, visit:  https://YOUR-URL.up.railway.app/health
   You should see:  {"ok":true,"season":...}
   (If you see {"error":"not found"} the OLD server is still running — make sure
    the new root server.js and package.json were uploaded.)
2. Open the game. The 1v1 tab should now find matches (needs TWO players in the
   queue — open the game in two browser tabs/devices to test).

## Notes
- Multiplayer needs NO wallet. Anyone can play 1v1.
- The shared leaderboard's competitive scores DO need a wallet sign-in (Phantom).
- Seasons are 3 days, derived from time — no setup needed.
