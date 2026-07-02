// Entry point. Usage:
//   npm start            run the bot (respects DRY_RUN in .env)
//   npm run dry          force a dry run
//   npm run login        just log in and save the session, then exit
import { CONFIG } from '../config.js';
import { launch, saveSession } from './browser.js';
import { login } from './login.js';
import { run } from './bot.js';
import { log } from './logger.js';

const loginOnly = process.argv.includes('--login-only');

async function main() {
  log.info(`duel-bot starting. DRY_RUN=${CONFIG.strategy.dryRun}, site=${CONFIG.urls.site}`);
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

    await page.goto(CONFIG.urls.duel, { waitUntil: 'domcontentloaded' });
    await run(page);
  } catch (e) {
    log.error(e.stack || e.message);
  } finally {
    await browser.close();
  }
}

main();
