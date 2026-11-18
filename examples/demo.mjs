#!/usr/bin/env node
// End-to-end demo of a guarded x402 buyer against three local "sellers" that answer HTTP 402.
// Counterparty facts come LIVE from the Concordium testnet CIS-8004 registry (read-only MCP).
//
//   node examples/demo.mjs                 dry run: payments are not signed (placeholder payload)
//   CCD_KEY_FILE=<wallet export .json> node examples/demo.mjs   (or raw hex key + CCD_ACCOUNT=<base58>)
//                                          real signer: ExactConcordiumScheme signs on testnet
//
// The local sellers do not settle on-chain (no facilitator); the point is which requests the
// guard lets the buyer sign at all.
import http from 'node:http';
import { createRegistryClient } from '../src/mcp.mjs';
import { createPayGuard } from '../src/payguard.mjs';
import { createGuardedFetch, CONCORDIUM_TESTNET } from '../src/x402guard.mjs';

const VERIFIED = Number(process.env.VERIFIED_AGENT || 1251); // Active, card hash OK, valid Badge
const UNBADGED = Number(process.env.UNBADGED_AGENT || 5); // Active but card 404 and no Badge
// A valid but unrelated account address (deterministic, nobody's agent wallet).
const { AccountAddress } = await import('@concordium/web-sdk');
const ATTACKER = AccountAddress.fromBuffer(Buffer.alloc(32, 7)).address;

const reg = createRegistryClient({ network: 'testnet' });
const walletOf = async (id) => {
  const w = await reg.agentWallet(id).catch(() => null);
  return typeof w === 'string' ? w : w?.agent_wallet ?? w?.wallet ?? null;
};
const [verifiedWallet, unbadgedWallet] = await Promise.all([walletOf(VERIFIED), walletOf(UNBADGED)]);

const sellers = {
  '/verified': { agentId: VERIFIED, payTo: verifiedWallet, label: `agent #${VERIFIED}, pays its declared wallet` },
  '/hijacked': { agentId: VERIFIED, payTo: ATTACKER, label: `claims agent #${VERIFIED}, payTo swapped to an attacker` },
  '/unbadged': { agentId: UNBADGED, payTo: unbadgedWallet || ATTACKER, label: `agent #${UNBADGED}, Active but no Badge` },
};

const server = http.createServer((req, res) => {
  const s = sellers[req.url];
  if (!s) { res.writeHead(404).end(); return; }
  if (req.headers['payment-signature'] || req.headers['x-payment']) {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ report: `paid content from ${req.url}` }));
    return;
  }
  const pr = {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: `http://localhost${req.url}`, description: s.label, mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: CONCORDIUM_TESTNET, asset: 'CCD', amount: '2000000', payTo: s.payTo, maxTimeoutSeconds: 300, extra: { feePayer: s.payTo, agentId: s.agentId } }],
  };
  res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(pr)).toString('base64') });
  res.end('{}');
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

async function makeScheme() {
  if (process.env.CCD_KEY_FILE) {
    const { ExactConcordiumScheme } = await import('@x402/concordium/exact/client');
    const { loadAccount } = await import('../src/keyfile.mjs');
    const acct = loadAccount(process.env.CCD_KEY_FILE, process.env.CCD_ACCOUNT); // key is never printed
    console.log(`Buyer account: ${acct.address}`);
    return { mode: 'real signer', scheme: new ExactConcordiumScheme({ accountAddress: acct.accountAddress, signer: acct.signer }) };
  }
  return { mode: 'dry run (no signing)', scheme: { scheme: 'exact', createPaymentPayload: async (v) => ({ x402Version: v, payload: { dryRun: true } }) } };
}

const { mode, scheme } = await makeScheme();
const guard = createPayGuard({ registry: reg });
const { fetch: payFetch } = createGuardedFetch({
  scheme, guard,
  onDecision: (r) => {
    const bad = r.assessment.reasons.filter((x) => x.level !== 'ok').map((x) => x.code);
    console.log(`  guard: ${r.verdict}${bad.length ? ` (${bad.join(', ')})` : ''} · agent #${r.tokenId} · ${r.amountCcd} CCD`);
  },
});

console.log(`Counterparty Guard x402 demo · ${mode} · registry: Concordium testnet\n`);
for (const [path, s] of Object.entries(sellers)) {
  console.log(`${path}: ${s.label}`);
  try {
    const res = await payFetch(`${base}${path}`);
    console.log(`  -> HTTP ${res.status}, ${mode === 'real signer' ? 'payment signed and sent' : 'dry-run payment payload sent (nothing signed)'}\n`);
  } catch (e) {
    console.log(`  -> refused before signing: ${String(e.message).replace(/^.*aborted: /, '')}\n`);
  }
}
console.log(`Spend today: ${guard.ledger?.global ?? 0} CCD`);
server.close();
