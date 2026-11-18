// x402 integration: the Counterparty Guard runs inside the x402 client's
// onBeforePaymentCreation hook, i.e. before the Concordium scheme signs anything.
// A BLOCK/REVIEW verdict aborts the payment; nothing is signed or sent.
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';

export const CONCORDIUM_TESTNET = 'ccd:4221332d34e1694168c2a0c0b3fd0f27';

/**
 * Attach a pay guard to an existing x402Client.
 * agentIdFor(requirements, paymentRequired) may return the payee's CIS-8004 token id
 * (e.g. the agent you discovered in the registry); otherwise requirements.extra.agentId is used.
 * onDecision(result, requirements) is called for every verdict (logging, UI).
 */
export function attachPayGuard(client, guard, { agentIdFor, onDecision } = {}) {
  const allowed = new WeakMap();
  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements: r }) => {
    const agentId = agentIdFor ? await agentIdFor(r, paymentRequired) : undefined;
    const res = await guard.check(r, { agentId });
    onDecision?.(res, r);
    if (!res.allowed) {
      const why = res.assessment.reasons.filter((x) => x.level !== 'ok').map((x) => x.code).join(',');
      return { abort: true, reason: `Counterparty Guard ${res.verdict} (${why})` };
    }
    allowed.set(r, res);
    return undefined;
  });
  // Count the spend once a payment payload was actually signed.
  client.onAfterPaymentCreation(async ({ selectedRequirements: r }) => {
    const res = allowed.get(r);
    if (res) guard.commit(res.tokenId, res.amountCcd);
  });
  return client;
}

/**
 * Build a guarded fetch for Concordium testnet.
 * scheme: an ExactConcordiumScheme (from '@x402/concordium/exact/client') built with the buyer's signer.
 * maxMicroCcdPerPayment keeps x402's own spend controls in line with the guard policy.
 */
export function createGuardedFetch({ scheme, guard, network = CONCORDIUM_TESTNET, maxMicroCcdPerPayment = '5000000', agentIdFor, onDecision, fetchImpl = fetch }) {
  const client = new x402Client().register('ccd:*', scheme);
  client.setSpendControls({ allowedAssets: [{ network, asset: 'CCD', maxAmountPerPayment: String(maxMicroCcdPerPayment) }] });
  attachPayGuard(client, guard, { agentIdFor, onDecision });
  return { client, fetch: wrapFetchWithPayment(fetchImpl, client) };
}
