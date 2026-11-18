// Minimal client for the public Concordium Agent Registry MCP server (streamable HTTP, JSON-RPC 2.0).
// Read-only tools only: nothing here signs or submits transactions.

export const REGISTRY_MCP = 'https://agent-registry-mcp.concordium.com/mcp';

export function createRegistryClient({ url = REGISTRY_MCP, network = 'testnet', timeoutMs = 30000 } = {}) {
  let initialised = false;
  let id = 0;
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

  async function rpc(method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (json.error) throw new Error(`MCP ${method}: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
  }

  async function init() {
    if (initialised) return;
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'counterparty-guard', version: '0.1.0' } });
    initialised = true;
  }

  async function call(name, args = {}) {
    await init();
    const result = await rpc('tools/call', { name, arguments: { network, ...args } });
    const text = result?.content?.[0]?.text ?? '';
    if (result?.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${name}: ${text.slice(0, 200)}`);
    }
  }

  return {
    network,
    call,
    contractInfo: () => call('contract_info'),
    listAgents: (limit = 100, offset = 0) => call('list_agents', { limit, offset }),
    agentOf: (tokenId) => call('agent_of', { token_id: tokenId }),
    tokenAddress: (contractIndex, tokenId) => call('token_address', { contract_index: contractIndex, contract_subindex: 0, token_id: tokenId }),
    checkBadge: (tokenAddress) => call('check_badge', { id: tokenAddress }),
    agentWallet: (tokenId) => call('get_agent_wallet', { token_id: tokenId }),
    history: (tokenId) => call('agent_history', { token_id: tokenId }),
    agentByTokenAddress: (addr) => call('agent_by_token_address', { token_address: addr }),
  };
}
