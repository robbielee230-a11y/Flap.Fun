// Selector-capture helper. Run this on a LOGGED-IN session to dump the page's
// frames and the interactive elements inside the BetBy iframe, so you can fill
// in the SEL_SB_* selectors in .env. Usage: `npm run inspect`.
import { CONFIG } from '../config.js';
import { log } from './logger.js';

const clip = (s) => (s || '').trim().replace(/\s+/g, ' ').slice(0, 50);

export async function inspect(page) {
  await page.goto(CONFIG.urls.sportsbook, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000); // let BetBy boot

  // 1) List all frames + their URLs so you can confirm the BetBy iframe src.
  log.info('--- FRAMES ---');
  for (const f of page.frames()) {
    console.log(`  name="${f.name()}"  url=${f.url()}`);
  }

  // 2) Try the configured BetBy iframe and dump its buttons/inputs.
  const iframe = page.locator(CONFIG.selectors.betbyIframe).first();
  if (!(await iframe.count().catch(() => 0))) {
    log.warn(
      `No element matched betbyIframe selector "${CONFIG.selectors.betbyIframe}". ` +
        'Pick the right iframe from the FRAMES list above and set SEL_BETBY_IFRAME.'
    );
    return;
  }
  const frame = page.frameLocator(CONFIG.selectors.betbyIframe);

  const dump = async (label, sel) => {
    const loc = frame.locator(sel);
    const n = Math.min(await loc.count().catch(() => 0), 25);
    log.info(`--- ${label} (${n}) ---`);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const text = clip(await el.textContent().catch(() => ''));
      const cls = clip(await el.getAttribute('class').catch(() => ''));
      const ph = await el.getAttribute('placeholder').catch(() => null);
      console.log(`  [${i}] text="${text}" ph="${ph || ''}" class="${cls}"`);
    }
  };

  await dump('BUTTONS', 'button');
  await dump('INPUTS', 'input');
  log.info(
    'Use the text/placeholder above to build stable locators, e.g. ' +
      `SEL_SB_PLACE='button:has-text("Place bet")'. Prefer text over class names.`
  );
}
