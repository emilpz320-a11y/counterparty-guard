// Sign and submit the "sign-ready" contract-update payloads that the Agent Registry MCP builds.
// The MCP holds no keys; we sign locally with the account loaded by keyfile.mjs.
import {
  AccountTransactionType, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName,
  TransactionExpiry, TransactionHash, signTransaction,
} from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';

export const TESTNET_GRPC = { host: 'grpc.testnet.concordium.com', port: 20000 };
export const explorerTx = (hash) => `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${hash}`;

export function grpcClient({ host, port } = TESTNET_GRPC) {
  return new ConcordiumGRPCNodeClient(host, port, credentials.createSsl());
}

/** built = output of an MCP build_* tool; account = loadAccount(...). Returns { hash, outcome }. */
export async function submitBuilt(client, account, built) {
  if (built.sender && built.sender !== account.address) throw new Error(`Payload is for ${built.sender}, signer is ${account.address}`);
  const { nonce } = await client.getNextAccountNonce(account.accountAddress);
  const tx = {
    type: AccountTransactionType.Update,
    header: { sender: account.accountAddress, nonce, expiry: TransactionExpiry.futureMinutes(5) },
    payload: {
      amount: CcdAmount.zero(),
      address: ContractAddress.create(built.contract_address.index, built.contract_address.subindex ?? 0),
      receiveName: ReceiveName.fromString(built.receive_name),
      message: Parameter.fromHexString(built.parameter_hex),
      maxContractExecutionEnergy: Energy.create(built.suggested_energy ?? 30000),
    },
  };
  const signature = await signTransaction(tx, account.signer);
  const hash = await client.sendAccountTransaction(tx, signature);
  const hex = TransactionHash.toHexString(hash);
  const outcome = await client.waitForTransactionFinalization(hash);
  const ok = outcome?.summary?.transactionType !== 'failed' && !outcome?.summary?.rejectReason;
  if (!ok) throw new Error(`Transaction ${hex} rejected: ${JSON.stringify(outcome?.summary?.rejectReason ?? outcome?.summary).slice(0, 300)}`);
  return { hash: hex, outcome };
}

/** Raw ed25519 signature (hex) by key 0/0 of the account, e.g. for setAgentWallet canonical bytes. */
export async function signBytes(account, bytes) {
  const sigs = await account.signer.sign(Buffer.from(bytes));
  return sigs[0][0];
}
