// Browser lifecycle + session persistence.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { CONFIG } from '../config.js';
import { log } from './logger.js';

export async function launch() {
  const stateFile = CONFIG.browser.storageState;
  const hasState = fs.existsSync(stateFile);

  const browser = await chromium.launch({
    headless: CONFIG.browser.headless,
    // slowMo makes it easier to watch what the bot is doing while you tune selectors
    slowMo: CONFIG.browser.headless ? 0 : 150,
  });

  const context = await browser.newContext(
    hasState ? { storageState: stateFile } : {}
  );
  if (hasState) log.info(`Loaded saved session from ${stateFile}`);

  const page = await context.newPage();
  return { browser, context, page };
}

export async function saveSession(context) {
  const stateFile = CONFIG.browser.storageState;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  await context.storageState({ path: stateFile });
  log.info(`Saved session to ${stateFile}`);
}
