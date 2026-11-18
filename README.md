# Counterparty Guard

**"Active" is not "trusted".** Before an AI agent pays another agent on Concordium, Counterparty Guard checks the payee against the CIS-8004 Agent Registry and returns `ALLOW`, `REVIEW` or `BLOCK`.

Built for the Concordium **Trusted Agents** hackathon (Encode Club).

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

Requires Node 20+. No dependencies; it talks to the public read-only registry MCP server (`https://agent-registry-mcp.concordium.com/mcp`).

```bash
npm test                                   # 9 unit tests
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
- `docs/`: static dashboard (GitHub Pages)

## Roadmap

1. Wrap an x402 client (`@x402/concordium`) so payments only go out after `ALLOW`.
2. Register our own buyer and seller agents on CIS-8004 with a Badge and show an end-to-end verified payment on testnet.

## License

MIT
