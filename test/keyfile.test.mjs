import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { AccountAddress } from '@concordium/web-sdk';
import { loadAccount } from '../src/keyfile.mjs';

const ADDR = AccountAddress.fromBuffer(Buffer.alloc(32, 7)).address;
const dir = mkdtempSync(join(tmpdir(), 'cg-keys-'));

test('reads a Wallet for Web export (concordium-client format)', () => {
  const sk = randomBytes(32).toString('hex');
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify({ type: 'concordium-browser-wallet-account', v: 0, environment: 'testnet', value: { accountKeys: { keys: { 0: { keys: { 0: { signKey: sk, verifyKey: '00'.repeat(32) } }, threshold: 1 } }, threshold: 1 }, credentials: { 0: 'ab' }, address: ADDR } }));
  const a = loadAccount(file);
  assert.equal(a.address, ADDR);
  assert.equal(typeof a.signer.sign, 'function');
});

test('raw hex key needs an explicit address', () => {
  const file = join(dir, 'raw.txt');
  writeFileSync(file, randomBytes(32).toString('hex'));
  assert.throws(() => loadAccount(file), /CCD_ACCOUNT/);
  assert.equal(loadAccount(file, ADDR).address, ADDR);
});
