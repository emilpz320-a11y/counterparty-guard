#!/usr/bin/env node
// Counterparty Guard CLI.
//   node src/guard.mjs check <tokenId> [--pay-to <addr> --amount <ccd>]
//   node src/guard.mjs scan [--limit 300] [--offset 0] [--out docs/data/scan.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistryClient } from './mcp.mjs';
import { assessCounterparty, summariseScan } from './assess.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : d;
};

export async function collectFacts(reg, tokenId, contractIndex) {
  const { token_address } = await reg.tokenAddress(contractIndex, tokenId);
  const [badge, wallet, history] = await Promise.all([
    reg.checkBadge(token_address),
    reg.agentWallet(tokenId).catch(() => null),
    reg.history(tokenId).catch(() => ({ events: [] })),
  ]);
  return { badge, wallet, history, now: Date.now() };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: e.message, item: items[k] }; }
    }
  }));
  return out;
}

async function main() {
  const reg = createRegistryClient({ network: opt('network', 'testnet') });
  const { cis8004_contract } = await reg.contractInfo();
  const contractIndex = cis8004_contract.index;

  if (args[0] === 'check') {
    const tokenId = Number(args[1]);
    const facts = await collectFacts(reg, tokenId, contractIndex);
    const payTo = opt('pay-to');
    const request = payTo ? { payTo, amountCcd: Number(opt('amount', '1')) } : null;
    const a = assessCounterparty(facts, request);
    console.log(`${a.verdict} (score ${a.score}) · token ${a.tokenId} · ${a.tokenAddress}`);
    for (const r of a.reasons) console.log(`  ${r.level.padEnd(6)} ${r.code.padEnd(22)} ${r.msg}`);
    return;
  }

  if (args[0] === 'scan') {
    const limit = Number(opt('limit', '300'));
    const offset = Number(opt('offset', '0'));
    const ids = [];
    for (let off = offset; ids.length < limit; off += 100) {
      const page = await reg.listAgents(Math.min(100, limit - ids.length), off);
      if (!page.agents?.length) break;
      ids.push(...page.agents.map((x) => x.token_id));
      if (page.agents.length < 100) break;
    }
    const rows = await pool(ids, 6, async (id) => {
      const facts = await collectFacts(reg, id, contractIndex);
      const a = assessCounterparty(facts);
      return {
        tokenId: id,
        tokenAddress: a.tokenAddress,
        owner: a.owner,
        agentUri: a.agentUri,
        ageHours: a.ageHours,
        verdict: a.verdict,
        score: a.score,
        checks: facts.badge?.checks,
        badge_valid: facts.badge?.badge_valid,
        reasons: a.reasons.filter((r) => r.level !== 'ok').map((r) => r.code),
      };
    });
    const good = rows.filter((r) => !r.error);
    const out = opt('out', 'docs/data/scan.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ network: reg.network, contract: cis8004_contract, scannedAt: new Date().toISOString(), summary: summariseScan(good), errors: rows.length - good.length, rows: good }, null, 1));
    console.log(JSON.stringify(summariseScan(good)), `errors=${rows.length - good.length}`, `→ ${out}`);
    return;
  }
  console.log('usage: guard.mjs check <tokenId> [--pay-to addr --amount ccd] | scan [--limit n]');
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main().catch((e) => { console.error(e.message); process.exit(1); });
