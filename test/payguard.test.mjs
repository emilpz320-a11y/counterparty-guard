import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayGuard, requirementAmountCcd, requirementAgentId, PaymentBlockedError } from '../src/payguard.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const WALLET = '3mC9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeCKA';
const OTHER = '4Abc9tNFNDhTLJNjHHEdrjkqvcCDLDbff1ceA1b9xah9cfxeZZZ';

const goodFacts = {
  badge: {
    token_id: 7, token_address: 'X', agent_uri: 'https://example.org/card.json', http_status: 200,
    on_chain: { owner_account: WALLET, status: 'Active' },
    checks: { on_chain_agent_found: true, status_active: true, has_agent_uri: true, card_fetched: true, hash_matches_on_chain: true, badge_present: true },
    badge_valid: true,
  },
  wallet: { agent_wallet: WALLET },
  history: { events: [{ event_name: 'Mint', timestamp: '2026-11-10T00:00:00Z' }] },
};
const noBadge = { ...goodFacts, badge: { ...goodFacts.badge, badge_valid: false, checks: { ...goodFacts.badge.checks, badge_present: false } } };

const req = (over = {}) => ({ scheme: 'exact', network: 'concordium:testnet', amount: '2000000', payTo: WALLET, extra: { agentId: 7 }, ...over });
const guardWith = (facts, opts = {}) => createPayGuard({ factsFor: async () => facts, now: () => NOW, ...opts });

test('amount is read in microCCD and agent id from extra or explicit', () => {
  assert.equal(requirementAmountCcd(req()), 2);
  assert.equal(requirementAmountCcd({ maxAmountRequired: '500000' }), 0.5);
  assert.equal(requirementAgentId(req()), 7);
  assert.equal(requirementAgentId(req(), 9), 9);
  assert.equal(requirementAgentId({ extra: {} }), null);
});

test('verified agent, declared wallet, within budget: ALLOW', async () => {
  const r = await guardWith(goodFacts).check(req());
  assert.equal(r.verdict, 'ALLOW');
  assert.equal(r.allowed, true);
  assert.equal(r.amountCcd, 2);
});

test('payTo that is not the agent wallet is blocked before signing', async () => {
  const r = await guardWith(goodFacts).check(req({ payTo: OTHER }));
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.assessment.reasons.some((x) => x.code === 'wallet_mismatch'));
});

test('agent without a Concordium Badge is blocked', async () => {
  const r = await guardWith(noBadge).check(req());
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.assessment.reasons.some((x) => x.code === 'no_badge'));
});

test('unknown payee and bad amounts are blocked without a registry lookup', async () => {
  let looked = 0;
  const g = createPayGuard({ factsFor: async () => { looked++; return goodFacts; }, now: () => NOW });
  assert.equal((await g.check(req({ extra: {} }))).assessment.reasons[0].code, 'unknown_agent');
  assert.equal((await g.check(req({ amount: '0' }))).assessment.reasons[0].code, 'bad_amount');
  assert.equal(looked, 0);
});

test('ledger enforces the per-counterparty daily cap across payments', async () => {
  const g = guardWith(goodFacts);
  for (let i = 0; i < 4; i++) {
    const r = await g.check(req({ amount: '5000000' }));
    assert.equal(r.verdict, 'ALLOW', `payment ${i + 1}`);
    g.commit(r.tokenId, r.amountCcd);
  }
  const fifth = await g.check(req({ amount: '1000000' }));
  assert.equal(fifth.verdict, 'BLOCK');
  assert.ok(fifth.assessment.reasons.some((x) => x.code === 'over_counterparty_cap'));
  assert.equal(g.ledger.byCounterparty['7'], 20);
});

test('PaymentBlockedError carries the reasons', async () => {
  const r = await guardWith(noBadge).check(req());
  const e = new PaymentBlockedError(r);
  assert.match(e.message, /BLOCK: .*Badge/);
  assert.equal(e.result, r);
});
