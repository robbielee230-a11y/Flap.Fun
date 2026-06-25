// Reads a wallet's on-chain balance of YOUR token, with a short DB cache.
import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from './config.js';
import { query } from './db.js';

const conn = CONFIG.TOKEN_MINT ? new Connection(CONFIG.SOLANA_RPC, 'confirmed') : null;
const MINT = CONFIG.TOKEN_MINT ? new PublicKey(CONFIG.TOKEN_MINT) : null;

// raw on-chain read: sum the wallet's token accounts for this mint, in whole tokens
async function readOnChain(walletStr) {
  if (!conn || !MINT) return 0; // token gating disabled (no mint configured)
  const owner = new PublicKey(walletStr);
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: MINT });
  let total = 0;
  for (const { account } of res.value) {
    const amt = account.data.parsed.info.tokenAmount;
    total += Number(amt.uiAmount || 0);
  }
  return total;
}

// public: cached balance. Returns whole-token balance (number).
export async function getBalance(walletStr) {
  // check cache
  try {
    const { rows } = await query(
      `SELECT balance, EXTRACT(EPOCH FROM (now() - fetched_at)) AS age
         FROM balance_cache WHERE wallet = $1`, [walletStr]);
    if (rows.length && rows[0].age < CONFIG.BALANCE_CACHE_SECONDS) {
      return Number(rows[0].balance);
    }
  } catch (e) { /* cache miss / table not ready — fall through to live read */ }

  // live read + upsert cache
  let bal = 0;
  try { bal = await readOnChain(walletStr); }
  catch (e) { console.warn('[balance] on-chain read failed for', walletStr, e.message); }

  try {
    await query(
      `INSERT INTO balance_cache (wallet, balance, fetched_at)
       VALUES ($1, $2, now())
       ON CONFLICT (wallet) DO UPDATE SET balance = EXCLUDED.balance, fetched_at = now()`,
      [walletStr, bal]);
  } catch (e) { /* non-fatal */ }

  return bal;
}

// map a balance to the highest token tier it satisfies (or null)
export function tierForBalance(balance) {
  const t = CONFIG.TIERS;
  if (balance >= t.t6) return 't6';
  if (balance >= t.t5) return 't5';
  if (balance >= t.t4) return 't4';
  if (balance >= t.t3) return 't3';
  if (balance >= t.t2) return 't2';
  if (balance >= t.t1) return 't1';
  return null;
}
