// Load a Concordium account signer from a file without ever printing the key.
// Accepts the JSON file that "Export private key" in Concordium Wallet for Web produces
// (concordium-client format), or a file with a raw ed25519 hex key plus an explicit address.
import { readFileSync } from 'node:fs';
import { AccountAddress, buildAccountSigner, buildBasicAccountSigner, parseWallet } from '@concordium/web-sdk';

export function loadAccount(path, explicitAddress) {
  const text = readFileSync(path, 'utf8').trim();
  if (text.startsWith('{')) {
    const wallet = parseWallet(text);
    const address = wallet.value.address;
    return { address, accountAddress: AccountAddress.fromBase58(address), signer: buildAccountSigner(wallet) };
  }
  if (!explicitAddress) throw new Error('A raw key file needs the account address (CCD_ACCOUNT).');
  if (!/^[0-9a-fA-F]{64}$/.test(text)) throw new Error('Key file is neither a wallet export nor a 32-byte hex key.');
  return { address: explicitAddress, accountAddress: AccountAddress.fromBase58(explicitAddress), signer: buildBasicAccountSigner(text) };
}
