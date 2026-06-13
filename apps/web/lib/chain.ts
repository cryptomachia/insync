// Read-only chain access + chain config shared across the app.
// Writes go through the wallet client from @handoff/auth (useWalletClient); this
// module only builds the public client and exposes config/helpers.
import { createPublicClient, defineChain, http, type Chain } from 'viem';
import { baseSepolia } from 'viem/chains';

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337');

export const IS_MOCK =
  String(process.env.NEXT_PUBLIC_MOCK ?? '').toLowerCase() === 'true';

const anvil = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export const chain: Chain = CHAIN_ID === 84532 ? baseSepolia : anvil;

// Single shared read client. Lazily created so it is safe in RSC/SSR.
let _client: ReturnType<typeof createPublicClient> | null = null;
export function publicClient() {
  if (!_client) {
    _client = createPublicClient({ chain, transport: http(RPC_URL) });
  }
  return _client;
}
