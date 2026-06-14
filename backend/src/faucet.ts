// Test-USDC faucet. The demo's pay token is a MockERC20 with a public `mint`, so the
// backend can top up a buyer's wallet on request (signed by the deployer key) — this lets a
// fresh email wallet fund an escrow without first sourcing USDC. Testnet only.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount)',
]);

export interface FaucetConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  token: Address;
  chainId: number;
}

export interface Faucet {
  /** Mint test USDC to `to` if its balance is below the top-up target. */
  drip(to: Address): Promise<{ txHash?: string; minted?: string; skipped?: boolean; balance: string }>;
}

const GRANT = 1_000n * 1_000_000n; // mint 1,000 test USDC (6 decimals) per top-up
const TARGET = 200n * 1_000_000n; // only top up wallets holding < 200
const COOLDOWN_MS = 15_000;

export function createFaucet(cfg: FaucetConfig): Faucet {
  const account = privateKeyToAccount(cfg.privateKey);
  const chain = cfg.chainId === baseSepolia.id ? baseSepolia : undefined;
  const pub = createPublicClient({ transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl), chain });
  const lastDrip = new Map<string, number>();

  return {
    async drip(to: Address) {
      const key = to.toLowerCase();
      const now = Date.now();
      if (now - (lastDrip.get(key) ?? 0) < COOLDOWN_MS) {
        throw Object.assign(new Error('Please wait a few seconds before requesting more test USDC.'), {
          statusCode: 429,
        });
      }
      const balance = (await pub.readContract({
        address: cfg.token,
        abi: erc20,
        functionName: 'balanceOf',
        args: [to],
      })) as bigint;
      if (balance >= TARGET) return { skipped: true, balance: balance.toString() };

      lastDrip.set(key, now);
      const txHash = await wallet.writeContract({
        address: cfg.token,
        abi: erc20,
        functionName: 'mint',
        args: [to, GRANT],
        account,
        chain,
      });
      await pub.waitForTransactionReceipt({ hash: txHash });
      return { txHash, minted: GRANT.toString(), balance: (balance + GRANT).toString() };
    },
  };
}
