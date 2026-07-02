// Entry point. Usage:
//   npm start            log in + run the sportsbook bot (respects DRY_RUN)
//   npm run dry          force a dry run (arms the bet slip, never places)
//   npm run login        just log in and save the session, then exit
//   npm run inspect      dump the BetBy iframe structure to capture selectors
import { CONFIG } from '../config.js';
import { launch, saveSession } from './browser.js';
import { login } from './login.js';
import { run } from './sportsbook.js';
import { inspect } from './inspect.js';
import { log } from './logger.js';

const loginOnly = process.argv.includes('--login-only');
const inspectMode = process.argv.includes('--inspect');

async function main() {
  log.info(
    `duel-bot starting. mode=${inspectMode ? 'inspect' : loginOnly ? 'login' : 'bet'}, ` +
      `DRY_RUN=${CONFIG.strategy.dryRun}, site=${CONFIG.urls.site}`
  );
  const { browser, context, page } = await launch();

  try {
    const ok = await login(page, context);
    if (!ok) {
      log.error('Could not log in. Exiting.');
      return;
    }
    await saveSession(context);

    if (loginOnly) {
      log.info('Login-only mode: session saved, exiting.');
      return;
    }
    if (inspectMode) {
      await inspect(page);
      return;
    }

    await run(page);
  } catch (e) {
    log.error(e.stack || e.message);
  } finally {
    await browser.close();
  }
}

main();
