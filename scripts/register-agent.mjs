#!/usr/bin/env node
// Register our own agent on the CIS-8004 Agent Registry (testnet), step by step, resumable.
//   CCD_KEY_FILE=<owner .export> node scripts/register-agent.mjs <step> [name]
// Steps: register | card | uri | wallet | status
// Public state (token id, tx hashes) is kept in docs/agents/<name>.state.json. Keys are never printed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRegistryClient } from '../src/mcp.mjs';
import { loadAccount } from '../src/keyfile.mjs';
import { grpcClient, submitBuilt, signBytes, explorerTx } from '../src/chain.mjs';

const [step = 'status', name = 'seller'] = process.argv.slice(2);
const PAGES = 'https://emilpz320-a11y.github.io/counterparty-guard';
const dir = 'docs/agents';
mkdirSync(dir, { recursive: true });
const statePath = `${dir}/${name}.state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { name, txs: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

const reg = createRegistryClient({ network: 'testnet' });
const acct = loadAccount(process.env.CCD_KEY_FILE, process.env.CCD_ACCOUNT);
const client = grpcClient();
const log = (label, r) => { state.txs.push({ label, hash: r.hash }); save(); console.log(`${label}: ${explorerTx(r.hash)}`); };

if (step === 'register') {
  if (state.tokenId != null) throw new Error(`Already registered as token ${state.tokenId}`);
  const before = await ownedTokens();
  const r = await submitBuilt(client, acct, await reg.call('build_register', { sender: acct.address }));
  log('register', r);
  const after = await ownedTokens();
  state.tokenId = after.find((t) => !before.includes(t)) ?? Math.max(...after);
  state.owner = acct.address;
  save();
  console.log('token id:', state.tokenId);
} else if (step === 'card') {
  const card = await reg.call('build_agent_card', {
    name: 'Counterparty Guard seller',
    description: 'Demo seller agent for Counterparty Guard: sells a counterparty risk report over x402, paid in CCD on Concordium testnet.',
    agent_uri: `${PAGES}/agents/${name}.json`,
    owner_account: acct.address,
    agent_wallet: acct.address,
    token_id: state.tokenId,
    version: '0.1.0',
    documentation_url: 'https://github.com/emilpz320-a11y/counterparty-guard',
  });
  const body = card.agent_card_json ?? JSON.stringify(card.agent_card ?? card, null, 2);
  console.log('other fields:', Object.keys(card).filter((k) => k !== 'agent_card_json').join(', '));
  writeFileSync(`${dir}/${name}.json`, body);
  console.log(`wrote ${dir}/${name}.json (sha256 ${createHash('sha256').update(body).digest('hex')}); publish it, then run "uri"`);
} else if (step === 'uri') {
  const uri = `${PAGES}/agents/${name}.json`;
  const served = Buffer.from(await (await fetch(uri, { cache: 'no-store' })).arrayBuffer());
  const hash = createHash('sha256').update(served).digest('hex');
  const r = await submitBuilt(client, acct, await reg.call('build_set_agent_uri', { token_id: state.tokenId, agent_uri: uri, metadata_hash_hex: hash, sender: acct.address }));
  state.agentUri = uri; state.cardHash = hash;
  log('setAgentURI', r);
} else if (step === 'wallet') {
  const deadline = Date.now() + 10 * 60 * 1000;
  const canon = await reg.call('set_agent_wallet_canonical_bytes', { token_id: state.tokenId, new_wallet: acct.address, deadline_unix_ms: deadline });
  const hex = canon.canonical_bytes_hex ?? canon.bytes_hex ?? canon.hex;
  const signature = await signBytes(acct, Buffer.from(hex, 'hex'));
  const r = await submitBuilt(client, acct, await reg.call('build_set_agent_wallet', { token_id: state.tokenId, new_wallet: acct.address, deadline_unix_ms: deadline, signature_hex: signature, sender: acct.address }));
  state.agentWallet = acct.address;
  log('setAgentWallet', r);
} else {
  console.log(JSON.stringify(state, null, 2));
  if (state.tokenId != null) {
    const { token_address } = await reg.tokenAddress((await reg.contractInfo()).cis8004_contract.index, state.tokenId);
    const b = await reg.checkBadge(token_address);
    console.log('checks:', JSON.stringify(b.checks), 'badge_valid:', b.badge_valid);
  }
}

async function ownedTokens() {
  const r = await reg.call('check_account_badges', { owner_account: acct.address }).catch(() => null);
  const list = r?.agents ?? r?.results ?? [];
  return list.map((a) => Number(a.token_id)).filter(Number.isFinite);
}
