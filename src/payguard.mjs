// Pay guard: decides whether an x402 payment may go out, BEFORE anything is signed.
// It maps the payment requirements to the payee's CIS-8004 agent, runs assessCounterparty
// (badge, card hash, Active status, payTo == declared agentWallet, budgets) and keeps a
// daily spend ledger so per-counterparty and global caps hold across calls.
import { assessCounterparty, recordSpend, spentFor, DEFAULT_POLICY } from './assess.mjs';
import { collectFacts } from './guard.mjs';

/** Amount in whole CCD from x402 requirements (amounts are strings in the smallest unit). */
export function requirementAmountCcd(req) {
  const raw = req?.amount ?? req?.maxAmountRequired;
  if (raw == null) return NaN;
  const decimals = Number(req?.extra?.decimals ?? 6); // CCD: 1 CCD = 1,000,000 microCCD
  return Number(BigInt(String(raw))) / 10 ** decimals;
}

/** The payee's agent id: the caller's explicit choice wins, then the seller's advertised id. */
export function requirementAgentId(req, explicit) {
  const id = explicit ?? req?.extra?.agentId ?? req?.extra?.agent_token_id;
  return id == null || id === '' ? null : Number(id);
}

export function createPayGuard({ registry, contractIndex, policy = DEFAULT_POLICY, ledger = null, now = () => Date.now(), factsFor } = {}) {
  let book = ledger;
  const getFacts = factsFor ?? (async (tokenId) => collectFacts(registry, tokenId, await resolveContract()));
  let contract = contractIndex;
  async function resolveContract() {
    if (contract == null) contract = (await registry.contractInfo()).cis8004_contract.index;
    return contract;
  }

  return {
    get ledger() { return book; },

    /** Returns { verdict, allowed, tokenId, amountCcd, assessment }. Never throws for a bad payee. */
    async check(requirements, { agentId } = {}) {
      const tokenId = requirementAgentId(requirements, agentId);
      const amountCcd = requirementAmountCcd(requirements);
      if (tokenId == null) {
        return deny('unknown_agent', 'Payment requirements do not name a CIS-8004 agent and none was given.', tokenId, amountCcd);
      }
      if (!Number.isFinite(amountCcd) || amountCcd <= 0) {
        return deny('bad_amount', 'Payment amount is missing or not positive.', tokenId, amountCcd);
      }
      const t = now();
      const facts = { ...(await getFacts(tokenId)), now: t };
      const assessment = assessCounterparty(facts, { payTo: requirements.payTo, amountCcd }, { policy, spent: spentFor(book, tokenId, t) });
      return { verdict: assessment.verdict, allowed: assessment.verdict === 'ALLOW', tokenId, amountCcd, assessment };
    },

    /** Record a payment that actually settled. */
    commit(tokenId, amountCcd) {
      book = recordSpend(book, tokenId, amountCcd, now());
      return book;
    },
  };
}

function deny(code, msg, tokenId, amountCcd) {
  return { verdict: 'BLOCK', allowed: false, tokenId, amountCcd, assessment: { verdict: 'BLOCK', score: 0, reasons: [{ level: 'block', code, msg }] } };
}

export class PaymentBlockedError extends Error {
  constructor(result) {
    const why = result.assessment.reasons.filter((r) => r.level !== 'ok').map((r) => r.msg).join(' ');
    super(`Counterparty Guard ${result.verdict}: ${why}`);
    this.name = 'PaymentBlockedError';
    this.result = result;
  }
}
