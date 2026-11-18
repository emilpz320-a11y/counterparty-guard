import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCounterparty, recordSpend, spentFor, summariseScan, DEFAULT_POLICY } from '../src/assess.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const WALLET = '3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA';

// Shape taken from a real check_badge response on testnet.
const badge = (over = {}) => ({
  token_id: 1241,
  token_address: 'JyP9Xyvghdx8ghH7F2qxS',
  agent_uri: 'https://example.org/card.json',
  http_status: 200,
  on_chain: { owner_account: WALLET, status: 'Active' },
  checks: { on_chain_agent_found: true, status_active: true, has_agent_uri: true, card_fetched: true, hash_matches_on_chain: true, badge_present: true, badge_well_formed: true },
  badge_valid: true,
  ...over,
});
const hist = (iso = '2026-11-10T00:00:00Z', extra = []) => ({ events: [{ event_name: 'Mint', timestamp: iso }, ...extra] });
const facts = (b = badge(), h = hist()) => ({ badge: b, wallet: { agent_wallet: WALLET }, history: h, now: NOW });

test('fully verified agent paying its declared wallet within budget is ALLOW', () => {
  const a = assessCounterparty(facts(), { payTo: WALLET, amountCcd: 1 });
  assert.equal(a.verdict, 'ALLOW');
  assert.equal(a.score, 100);
  assert.deepEqual(a.reasons.map((r) => r.code), ['active', 'card_match', 'badge', 'wallet_match']);
});

test('Active is not enough: unreachable card and missing badge BLOCK', () => {
  const b = badge({ http_status: 404, badge_valid: false, checks: { ...badge().checks, card_fetched: false, hash_matches_on_chain: false, badge_present: false } });
  const a = assessCounterparty(facts(b));
  assert.equal(a.verdict, 'BLOCK');
  assert.ok(a.reasons.some((r) => r.code === 'card_unreachable'));
  assert.ok(a.reasons.some((r) => r.code === 'no_badge'));
});

test('tampered card (hash mismatch) BLOCKs; relaxed policy downgrades to REVIEW', () => {
  const b = badge({ checks: { ...badge().checks, hash_matches_on_chain: false } });
  assert.equal(assessCounterparty(facts(b)).verdict, 'BLOCK');
  assert.equal(assessCounterparty(facts(b), null, { policy: { ...DEFAULT_POLICY, requireCardMatch: false } }).verdict, 'REVIEW');
});

test('revoked or unregistered agents BLOCK', () => {
  const revoked = badge({ on_chain: { status: 'Revoked' }, checks: { ...badge().checks, status_active: false } });
  assert.equal(assessCounterparty(facts(revoked)).reasons[0].code, 'not_active');
  const missing = badge({ checks: { on_chain_agent_found: false } });
  assert.equal(assessCounterparty(facts(missing)).verdict, 'BLOCK');
});

test('payment to a wallet other than the declared one is BLOCKed', () => {
  const a = assessCounterparty(facts(), { payTo: '4AttackerWallet000000000000000000000000000000000000', amountCcd: 1 });
  assert.equal(a.verdict, 'BLOCK');
  assert.ok(a.reasons.some((r) => r.code === 'wallet_mismatch'));
});

test('spending caps: per payment, per counterparty per day, global per day', () => {
  assert.ok(assessCounterparty(facts(), { payTo: WALLET, amountCcd: 6 }).reasons.some((r) => r.code === 'over_payment_cap'));
  assert.ok(assessCounterparty(facts(), { payTo: WALLET, amountCcd: 2 }, { spent: { counterparty: 19, global: 19 } }).reasons.some((r) => r.code === 'over_counterparty_cap'));
  assert.ok(assessCounterparty(facts(), { payTo: WALLET, amountCcd: 2 }, { spent: { counterparty: 0, global: 49 } }).reasons.some((r) => r.code === 'over_global_cap'));
});

test('new agents and ownership transfers go to REVIEW', () => {
  const fresh = assessCounterparty(facts(badge(), hist('2026-11-18T11:30:00Z')));
  assert.equal(fresh.verdict, 'REVIEW');
  assert.ok(fresh.reasons.some((r) => r.code === 'new_agent'));
  const moved = assessCounterparty(facts(badge(), hist(undefined, [{ event_name: 'Transfer', timestamp: '2026-11-12T00:00:00Z' }])));
  assert.ok(moved.reasons.some((r) => r.code === 'ownership_changed'));
});

test('ledger accumulates per day and resets the next day', () => {
  let l = recordSpend(null, 7, 1.5, NOW);
  l = recordSpend(l, 7, 2, NOW);
  l = recordSpend(l, 9, 1, NOW);
  assert.deepEqual(spentFor(l, 7, NOW), { counterparty: 3.5, global: 4.5 });
  assert.deepEqual(spentFor(l, 7, NOW + 864e5), { counterparty: 0, global: 0 });
});

test('scan summary counts active-but-untrusted agents', () => {
  const rows = [
    { checks: { status_active: true, card_fetched: true, hash_matches_on_chain: true }, badge_valid: true, verdict: 'ALLOW' },
    { checks: { status_active: true, card_fetched: false, hash_matches_on_chain: false }, badge_valid: false, verdict: 'BLOCK' },
    { checks: { status_active: false }, badge_valid: false, verdict: 'BLOCK' },
  ];
  const s = summariseScan(rows);
  assert.equal(s.scanned, 3);
  assert.equal(s.active, 2);
  assert.equal(s.activeButUntrusted, 1);
  assert.equal(s.allowPct, 33.3);
});
