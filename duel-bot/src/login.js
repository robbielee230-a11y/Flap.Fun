// Login flow. Two paths:
//   1) A saved session already exists -> we just verify we're logged in.
//   2) No session -> fill credentials, submit, then save the session.
// If the site uses 2FA / captcha, run `npm run login` with HEADLESS=false and
// finish the challenge by hand in the window; the session is saved afterwards.
import { CONFIG } from '../config.js';
import { saveSession } from './browser.js';
import { log } from './logger.js';

const S = CONFIG.selectors;

export async function isLoggedIn(page) {
  try {
    await page.goto(CONFIG.urls.site, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(S.loggedInMarker, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function login(page, context) {
  if (await isLoggedIn(page)) {
    log.info('Already logged in (via saved session).');
    return true;
  }

  log.info('Logging in…');
  await page.goto(CONFIG.urls.login, { waitUntil: 'domcontentloaded' });

  // duel.com opens login in a modal — click the button that reveals the form.
  try {
    await page.click(S.openLoginButton, { timeout: 8000 });
  } catch {
    log.warn('Could not find/open the login button — the form may already be visible.');
  }

  if (!CONFIG.creds.username || !CONFIG.creds.password) {
    log.warn(
      'No credentials set. Log in manually in the open window, then the session ' +
        'will be saved. (Set HEADLESS=false for this.)'
    );
  } else {
    await page.fill(S.usernameInput, CONFIG.creds.username);
    await page.fill(S.passwordInput, CONFIG.creds.password);
    await page.click(S.loginButton);
  }

  // Wait for the post-login marker — this also gives time to solve 2FA/captcha
  // by hand when running non-headless.
  try {
    await page.waitForSelector(S.loggedInMarker, { timeout: 120_000 });
  } catch {
    log.error('Never saw the logged-in marker. Check SEL_LOGGED_IN selector or credentials.');
    return false;
  }

  await saveSession(context);
  log.info('Login successful.');
  return true;
}
