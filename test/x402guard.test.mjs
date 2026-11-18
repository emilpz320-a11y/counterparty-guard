// Runs the real @x402/core client with a fake Concordium scheme that records whether it was asked to sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x402Client } from '@x402/fetch';
import { attachPayGuard, CONCORDIUM_TESTNET } from '../src/x402guard.mjs';
import { createPayGuard } from '../src/payguard.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const WALLET = '3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA';
const OTHER = '4FmiTW2L4RvCsSVTjFAavYvrgnPLGNj43eiwPYmbhNqtAcMbWW';
const facts = (badgeValid = true) => ({
  badge: {
    token_id: 7, token_address: 'X', agent_uri: 'https://example.org/card.json', http_status: 200,
    on_chain: { owner_account: WALLET, status: 'Active' },
    checks: { on_chain_agent_found: true, status_active: true, has_agent_uri: true, card_fetched: true, hash_matches_on_chain: true, badge_present: badgeValid },
    badge_valid: badgeValid,
  },
  wallet: { agent_wallet: WALLET },
  history: { events: [{ event_name: 'Mint', timestamp: '2026-11-10T00:00:00Z' }] },
});

function fakeScheme() {
  const s = { scheme: 'exact', signed: 0 };
  s.createPaymentPayload = async (x402Version) => { s.signed++; return { x402Version, payload: { fake: true } }; };
  return s;
}
const paymentRequired = (over = {}) => ({
  x402Version: 2,
  resource: { url: 'https://seller.example/report' },
  accepts: [{ scheme: 'exact', network: CONCORDIUM_TESTNET, asset: 'CCD', amount: '2000000', payTo: WALLET, maxTimeoutSeconds: 300, extra: { feePayer: 'F', agentId: 7, ...over.extra }, ...over }],
});
function setup(f = facts()) {
  const scheme = fakeScheme();
  const guard = createPayGuard({ factsFor: async () => f, now: () => NOW });
  const decisions = [];
  const client = new x402Client().register('ccd:*', scheme);
  client.setSpendControls(false);
  attachPayGuard(client, guard, { onDecision: (r) => decisions.push(r.verdict) });
  return { scheme, guard, client, decisions };
}

test('verified payee: x402 signs and the spend is recorded', async () => {
  const { scheme, guard, client, decisions } = setup();
  const p = await client.createPaymentPayload(paymentRequired());
  assert.equal(p.payload.fake, true);
  assert.equal(scheme.signed, 1);
  assert.deepEqual(decisions, ['ALLOW']);
  assert.equal(guard.ledger.global, 2);
});

test('payTo hijacked to another address: aborted before signing', async () => {
  const { scheme, guard, client, decisions } = setup();
  await assert.rejects(client.createPaymentPayload(paymentRequired({ payTo: OTHER })), /Payment creation aborted: Counterparty Guard BLOCK \(wallet_mismatch\)/);
  assert.equal(scheme.signed, 0);
  assert.deepEqual(decisions, ['BLOCK']);
  assert.equal(guard.ledger, null);
});

test('payee without a Concordium Badge: aborted before signing', async () => {
  const { scheme, client } = setup(facts(false));
  await assert.rejects(client.createPaymentPayload(paymentRequired()), /no_badge/);
  assert.equal(scheme.signed, 0);
});
