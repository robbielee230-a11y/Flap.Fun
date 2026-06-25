// Root entry point — launches the real backend in src/server.js.
// (Railway / Nixpacks may auto-pick this root file; this guarantees the
//  correct server runs: leaderboard + auth + 1v1 multiplayer at /ws, and it
//  serves the game's static files from /public.)
import './src/server.js';
