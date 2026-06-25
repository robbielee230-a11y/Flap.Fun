// Wallet-ownership auth: issue a nonce, verify a signed nonce, mint a session JWT.
import crypto from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import jwt from 'jsonwebtoken';
import { CONFIG } from './config.js';
import { query } from './db.js';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// basic sanity check that a string looks like a base58 Solana pubkey (32 bytes)
export function isValidWallet(w) {
  if (typeof w !== 'string' || w.length < 32 || w.length > 44) return false;
  try { return bs58.decode(w).length === 32; } catch { return false; }
}

// issue a one-time challenge for a wallet
export async function issueNonce(wallet) {
  const nonce = `Flappy sign-in: ${crypto.randomBytes(16).toString('hex')}`;
  const expires = new Date(Date.now() + NONCE_TTL_MS);
  await query(
    `INSERT INTO nonces (wallet, nonce, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (wallet) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
    [wallet, nonce, expires]);
  return { nonce, expires: expires.getTime() };
}

// verify a signed nonce. On success, consume the nonce and return a session token.
export async function verifySignature(wallet, signatureB58, nonce) {
  const { rows } = await query(
    `SELECT nonce, expires_at FROM nonces WHERE wallet = $1`, [wallet]);
  if (!rows.length) throw new Error('no_nonce');
  const row = rows[0];
  if (row.nonce !== nonce) throw new Error('nonce_mismatch');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('nonce_expired');

  // verify the Ed25519 signature against the wallet pubkey
  let ok = false;
  try {
    const msg = new TextEncoder().encode(nonce);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(wallet);
    ok = nacl.sign.detached.verify(msg, sig, pub);
  } catch { ok = false; }
  if (!ok) throw new Error('bad_signature');

  // single-use: delete the nonce
  await query(`DELETE FROM nonces WHERE wallet = $1`, [wallet]);

  const token = jwt.sign({ wallet }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.SESSION_TTL_SECONDS });
  return { session: token };
}

// express middleware: require a valid session, attach req.wallet
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'no_session' });
  try {
    const payload = jwt.verify(m[1], CONFIG.JWT_SECRET);
    req.wallet = payload.wallet;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_session' });
  }
}

// verify a raw session token (used by the WebSocket match server). Returns the
// wallet string if valid, or null. Lets us tie 1v1 wins to a real wallet.
export function verifySessionToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, CONFIG.JWT_SECRET);
    return payload.wallet || null;
  } catch {
    return null;
  }
}
