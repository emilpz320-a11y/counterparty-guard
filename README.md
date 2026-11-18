# Counterparty Guard

**"Active" is not "trusted".** Before an AI agent pays another agent on Concordium, Counterparty Guard checks the payee against the CIS-8004 Agent Registry and returns `ALLOW`, `REVIEW` or `BLOCK`.

Built for the Concordium **Trusted Agents** hackathon (Encode Club).

- Demo video: https://youtu.be/u1ViCRawwLI
- Live dashboard (full testnet scan): https://emilpz320-a11y.github.io/counterparty-guard/
- Data: [`docs/data/scan.json`](docs/data/scan.json)

## Why

Agent-to-agent payments (x402) make it trivial for one agent to pay another. The registry tells you an agent exists and is *Active*, but that alone does not mean someone accountable stands behind it, that its Agent Card is the one it registered, or that the `payTo` address really belongs to it.

Our scan of **all 1,251 agents** on the testnet registry found:

| | |
|---|---|
| Registered | 1,251 |
| Active | 269 |
| Active **but failing at least one check** | 198 (74%) |
| With a valid Concordium Badge | 80 |
| Pass every check (ALLOW) | 71 |

## What it checks

| Check | Effect if it fails |
|---|---|
| Registered and **Active** on CIS-8004 | BLOCK |
| Agent Card fetched and its **SHA-256 matches** the on-chain anchor | BLOCK |
| Valid **Concordium Badge** (identity-verified owner) | BLOCK (policy: `requireBadge`) |
| NFT ownership not changed recently | REVIEW |
| Agent older than `minAgeHours` | REVIEW |
| `payTo` equals the agent's declared **agentWallet** | BLOCK |
| Amount within **per-payment / per-counterparty / global daily** budgets | BLOCK |

Default policy (`src/assess.mjs`): 5 CCD per payment, 20 CCD per counterparty per day, 50 CCD per day overall.

## Use

Requires Node 20+. The checks talk to the public read-only registry MCP server (`https://agent-registry-mcp.concordium.com/mcp`).

```bash
npm install
npm test                                   # 19 unit tests (guard, ledger, x402 hook)
npm run demo                               # guarded x402 buyer vs three local sellers
node src/guard.mjs check 1251 --amount 5   # assess one agent (add --pay-to <addr>)
node src/guard.mjs scan --out docs/data/scan.json   # rescan the whole registry
```

Example:

```
ALLOW (score 100) · token 1251
  ok     active       Registered and Active on the CIS-8004 registry.
  ok     card_match   Agent Card matches its on-chain SHA-256 anchor.
  ok     badge        Valid Concordium Badge: an identity-verified owner is accountable.
```

In code:

```js
import { createRegistryClient } from './src/mcp.mjs';
import { collectFacts } from './src/guard.mjs';
import { assessCounterparty } from './src/assess.mjs';

const reg = createRegistryClient({ network: 'testnet' });
const { cis8004_contract } = await reg.contractInfo();
const facts = await collectFacts(reg, tokenId, cis8004_contract.index);
const { verdict, reasons } = assessCounterparty(facts, { payTo, amountCcd: 3 });
if (verdict !== 'ALLOW') {
  throw new Error('Refusing to pay: ' + reasons.filter((r) => r.level !== 'ok').map((r) => r.msg).join('; '));
}
```

## Layout

- `src/mcp.mjs`: minimal read-only MCP client for the Concordium Agent Registry
- `src/assess.mjs`: verdict engine, spend ledger and scan summary
- `src/guard.mjs`: CLI (`check`, `scan`)
- `src/payguard.mjs`: maps x402 payment requirements to the payee agent and decides
- `src/x402guard.mjs`: hook into the x402 client and a guarded `fetch`
- `examples/demo.mjs`: end-to-end demo (dry run)
- `examples/live.mjs`: real x402 payment on testnet with in-process facilitator
- `src/chain.mjs`, `scripts/register-agent.mjs`: sign and submit Agent Registry payloads
- `docs/`: static dashboard (GitHub Pages)

## x402: pay only verified agents

`src/x402guard.mjs` plugs the guard into the official x402 client (`@x402/fetch` + `@x402/concordium`). It runs in the client's `onBeforePaymentCreation` hook, so a `BLOCK` or `REVIEW` verdict aborts the payment **before the Concordium scheme signs anything**. Signed payments are recorded in a daily ledger, so per-counterparty and global caps hold across calls. x402's own spend controls are set to the same per-payment cap.

```js
import { ExactConcordiumScheme } from '@x402/concordium/exact/client';
import { AccountAddress, buildBasicAccountSigner } from '@concordium/web-sdk';
import { createRegistryClient } from './src/mcp.mjs';
import { createPayGuard } from './src/payguard.mjs';
import { createGuardedFetch } from './src/x402guard.mjs';

const scheme = new ExactConcordiumScheme({ accountAddress: AccountAddress.fromBase58(ACCOUNT), signer: buildBasicAccountSigner(KEY) });
const guard = createPayGuard({ registry: createRegistryClient({ network: 'testnet' }) });
const { fetch: payFetch } = createGuardedFetch({ scheme, guard });

await payFetch('https://seller.example/report'); // throws "...aborted: Counterparty Guard BLOCK (wallet_mismatch)" for a bad payee
```

The payee's agent id comes from `requirements.extra.agentId` (sellers advertise their CIS-8004 token id) or from `agentIdFor(requirements)` when the buyer already chose the agent in the registry.

### Demo

`npm run demo` starts three local sellers that answer HTTP 402 and pays them through the guarded client, with counterparty facts read live from the testnet registry:

```
/verified: agent #1251, pays its declared wallet
  guard: ALLOW · agent #1251 · 2 CCD
  -> HTTP 200
/hijacked: claims agent #1251, payTo swapped to an attacker
  guard: BLOCK (wallet_mismatch) · agent #1251 · 2 CCD
  -> refused before signing
/unbadged: agent #5, Active but no Badge
  guard: BLOCK (card_unreachable, no_badge) · agent #5 · 2 CCD
  -> refused before signing
```

Without credentials it is a dry run (nothing is signed). With `CCD_ACCOUNT=<address> CCD_KEY_FILE=<file with the ed25519 key>` it uses the real `ExactConcordiumScheme` signer. The local sellers do not settle on chain.

## Live on testnet

Our own seller agent is registered on the CIS-8004 registry and passes every check:

- Agent **#1254**, card at [`docs/agents/seller.json`](docs/agents/seller.json), Verified by Concordium badge valid, payment wallet declared on chain.
- Register: [tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=2b2b2c9c647f68706441b41cb0404aea2e293ec317a8256bbf4b74df631ee29a) · setAgentWallet: [tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=d44128066101373ff03fbedf257483c066f40479c330382307fdfe1d866abc70) · setAgentURI: [tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=cb893d8f3e33204bb6f138b0453e54e62f1102721df1af65253477d4e555d311)

`examples/live.mjs` runs the whole x402 flow on testnet in one process: an in-process facilitator (the seller's account sponsors the fee), a resource server with two routes, and the guarded buyer.

```
/report
  guard: ALLOW · agent #1254 · 2 CCD
  -> HTTP 200, settled on-chain
/tampered          (same offer, payTo swapped)
  guard: BLOCK (wallet_mismatch) · agent #1254 · 2 CCD
  -> refused before signing
```

Settled payment (2 CCD, sponsored transfer, finalized): [0082eacf…a3a6](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=0082eacf529c18d0e940eb2679bf69774c3936f2b548e326a185c1b72b2ca3a6)

```bash
BUYER_KEY_FILE=<buyer .export> SELLER_KEY_FILE=<seller .export> node examples/live.mjs
CCD_KEY_FILE=<owner .export> node scripts/register-agent.mjs register|card|uri|wallet|status [name]
```

Key files are the JSON exports from Concordium Wallet for Web; `src/keyfile.mjs` loads them and keys are never printed.

## Roadmap

1. Register the buyer as an agent too, and let sellers check buyers (mutual verification).
2. Optional REVIEW flow: ask a human before paying a new or recently transferred agent instead of refusing.

## License

MIT
