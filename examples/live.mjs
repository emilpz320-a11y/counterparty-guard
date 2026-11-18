#!/usr/bin/env node
// LIVE x402 payment on Concordium testnet, guarded by Counterparty Guard.
//   BUYER_KEY_FILE=<buyer .export> SELLER_KEY_FILE=<seller .export> SELLER_AGENT=1254 node examples/live.mjs
// - Seller: our own CIS-8004 agent; its account also runs an in-process facilitator that sponsors gas.
// - Buyer: guarded x402 client. It pays only after the guard checks the seller on the registry.
// - Two requests: the honest route (payTo = declared agent wallet) settles on-chain;
//   a tampered route (payTo swapped) is refused before anything is signed.
// Keys are read from the wallet export files and never printed.
import http from 'node:http';
import { AccountAddress } from '@concordium/web-sdk';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer, x402HTTPResourceServer } from '@x402/core/server';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { ExactConcordiumScheme as FacScheme } from '@x402/concordium/exact/facilitator';
import { ExactConcordiumScheme as SrvScheme } from '@x402/concordium/exact/server';
import { ExactConcordiumScheme as CliScheme } from '@x402/concordium/exact/client';
import { toConcordiumFacilitatorSigner, CONCORDIUM_TESTNET_CAIP2 as NET } from '@x402/concordium';
import { loadAccount } from '../src/keyfile.mjs';
import { createRegistryClient } from '../src/mcp.mjs';
import { createPayGuard } from '../src/payguard.mjs';
import { createGuardedFetch } from '../src/x402guard.mjs';
import { explorerTx } from '../src/chain.mjs';

const AGENT = Number(process.env.SELLER_AGENT || 1254);
const buyer = loadAccount(process.env.BUYER_KEY_FILE);
const seller = loadAccount(process.env.SELLER_KEY_FILE);
const ATTACKER = AccountAddress.fromBuffer(Buffer.alloc(32, 7)).address;
const PRICE = { amount: '2000000', asset: 'CCD' }; // 2 CCD

// Facilitator (seller sponsors the fee)
const facSigner = toConcordiumFacilitatorSigner(seller.address, seller.signer, { host: 'grpc.testnet.concordium.com', port: 20000, useTls: true, network: NET });
const fac = new x402Facilitator().register(NET, new FacScheme({ signer: facSigner }));
const facClient = { verify: (p, r) => fac.verify(p, r), settle: (p, r) => fac.settle(p, r), getSupported: async () => fac.getSupported() };

// Resource server with two routes
const route = (payTo, description) => ({ accepts: { scheme: 'exact', network: NET, payTo, price: PRICE, maxTimeoutSeconds: 300, extra: { agentId: AGENT } }, description, mimeType: 'application/json' });
const routes = {
  'GET /report': route(seller.address, `Counterparty report from agent #${AGENT}`),
  'GET /tampered': route(ATTACKER, `Same offer, payTo swapped to ${ATTACKER.slice(0, 8)}…`),
};
const rs = new x402ResourceServer(facClient).register(NET, new SrvScheme());
const hs = new x402HTTPResourceServer(rs, routes);
await hs.initialize();

const send = (res, s, h, b) => { res.writeHead(s, h); res.end(b === undefined ? '' : typeof b === 'string' ? b : JSON.stringify(b)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const adapter = {
    getHeader: (n) => { const v = req.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
    getMethod: () => req.method, getPath: () => url.pathname, getUrl: () => url.href,
    getAcceptHeader: () => 'application/json', getUserAgent: () => req.headers['user-agent'] ?? 'node',
  };
  try {
    const r = await hs.processHTTPRequest({ adapter, path: url.pathname, method: req.method });
    if (r.type === 'no-payment-required') return send(res, 404, {}, 'not found');
    if (r.type === 'payment-error') return send(res, r.response.status, r.response.headers, r.response.body);
    const s = await hs.processSettlement(r.paymentPayload, r.paymentRequirements, r.declaredExtensions);
    if (!s.success) return send(res, s.response?.status ?? 402, { ...(s.response?.headers ?? {}), ...(s.headers ?? {}) }, s.response?.body ?? { error: s.errorReason });
    send(res, 200, { 'Content-Type': 'application/json', ...s.headers }, { report: 'counterparty report (demo)', tx: s.transaction });
  } catch (e) { send(res, 500, {}, String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://localhost:${server.address().port}`;

// Guarded buyer
const guard = createPayGuard({ registry: createRegistryClient({ network: 'testnet' }) });
const { fetch: payFetch } = createGuardedFetch({
  scheme: new CliScheme({ accountAddress: buyer.accountAddress, signer: buyer.signer }),
  guard,
  onDecision: (r) => {
    const bad = r.assessment.reasons.filter((x) => x.level !== 'ok').map((x) => x.code);
    console.log(`  guard: ${r.verdict}${bad.length ? ` (${bad.join(', ')})` : ''} · agent #${r.tokenId} · ${r.amountCcd} CCD`);
  },
});

console.log(`Counterparty Guard · LIVE on Concordium testnet\nbuyer ${buyer.address}\nseller agent #${AGENT}, wallet ${seller.address}\n`);
for (const path of Object.keys(routes).map((k) => k.split(' ')[1])) {
  console.log(`${path}`);
  try {
    const res = await payFetch(`${base}${path}`);
    const body = await res.json().catch(() => ({}));
    const hdr = res.headers.get('PAYMENT-RESPONSE');
    const tx = (hdr && decodePaymentResponseHeader(hdr).transaction) || body.tx;
    console.log(`  -> HTTP ${res.status}${tx ? `, settled on-chain: ${explorerTx(tx)}` : ` ${JSON.stringify(body).slice(0, 200)}`}\n`);
  } catch (e) {
    console.log(`  -> refused before signing: ${String(e.message).replace(/^.*aborted: /, '')}\n`);
  }
}
server.close();
process.exit(0);
