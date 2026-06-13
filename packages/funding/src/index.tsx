// AGENT 6 — Funding package (Blink one-tap USDC deposit). SPEC §8.
//
// Exports (FROZEN — do not rename):
//   FundButton(props)  → the one-tap CTA; calls fund(), fires onFunded(dealId)/onError(e)
//   useFunding()       → { fund(args): Promise<bigint /* dealId */> }
//
// fund() flow:
//   1. read the listing's payToken via escrowAbi.getListing
//   2. LIVE mode (NEXT_PUBLIC_BLINK_API_KEY set, NEXT_PUBLIC_MOCK!=true): pull USDC into the
//      buyer's wallet in one tap via the Blink SDK (@swype-org/deposit), then approve + fund.
//   3. MOCK mode (NEXT_PUBLIC_MOCK=true): skip Blink — just ERC20 approve + fund directly with
//      the provided viem walletClient against local anvil (still a real on-chain tx).
//   4. ensure ERC20 allowance (approve Escrow for tokenAmount if short), call Escrow.fund,
//      and resolve with the dealId parsed from the Funded event.
import React from 'react';
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
  type WalletClient,
} from 'viem';
import { escrowAbi, getAddresses, IS_MOCK } from '@handoff/contracts-abi';

export type FundArgs = {
  listingId: bigint;
  tokenAmount: bigint;
  freeCancelUntil: bigint;
  expiry: bigint;
  walletClient: WalletClient;
};

// Minimal ERC20 surface we need (allowance/approve). viem human-readable.
const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

function env(key: string): string | undefined {
  const e = (globalThis as any)?.process?.env ?? {};
  const v = e[key];
  return v == null || v === '' ? undefined : String(v);
}

const RPC =
  env('NEXT_PUBLIC_RPC_URL') ?? env('RPC_URL') ?? 'http://127.0.0.1:8545';

const BLINK_API_KEY = env('NEXT_PUBLIC_BLINK_API_KEY');
const BLINK_MERCHANT_ID = env('NEXT_PUBLIC_BLINK_MERCHANT_ID');
const CHAIN_ID = Number(env('NEXT_PUBLIC_CHAIN_ID') ?? env('CHAIN_ID') ?? '31337');

// Live Blink only when not mocking AND a key is present. Otherwise we run the pure
// on-chain approve+fund path (works offline against anvil with no Blink account).
const USE_BLINK = !IS_MOCK && !!BLINK_API_KEY;

/**
 * Pull USDC into the buyer's wallet via Blink's one-tap deposit modal.
 * Lazy-imported so the package builds/runs with no Blink dep installed (mock mode).
 * Returns when the deposit settles; throws on user cancel / failure.
 */
async function blinkPullDeposit(opts: {
  address: Address;
  token: Address;
  tokenAmount: bigint;
}): Promise<void> {
  // Dynamic import keeps @swype-org/deposit optional (only needed for live mode); the
  // package is not a dependency here so mock builds stay lean. @ts-ignore: the specifier
  // resolves at runtime in apps that install it, and the .catch() handles its absence.
  // @ts-ignore -- optional live-only dependency, not installed in mock mode
  const mod: any = await import(/* webpackIgnore: true */ '@swype-org/deposit').catch(
    () => {
      throw new Error(
        'Blink live mode requires the @swype-org/deposit package. Install it or set NEXT_PUBLIC_MOCK=true.',
      );
    },
  );
  const deposit = mod.createDeposit
    ? mod.createDeposit({
        apiKey: BLINK_API_KEY,
        merchantId: BLINK_MERCHANT_ID,
        chainId: CHAIN_ID,
        token: opts.token,
      })
    : mod.default?.({ apiKey: BLINK_API_KEY, merchantId: BLINK_MERCHANT_ID });

  // Blink takes whole-USDC amounts; USDC has 6 decimals on-chain.
  const amount = Number(opts.tokenAmount) / 1e6;
  await deposit.requestDeposit({
    amount,
    chainId: CHAIN_ID,
    address: opts.address,
    token: opts.token,
  });
}

/**
 * Ensure the Escrow is approved to pull `amount` of `token` from `owner`.
 * Reads current allowance and only sends an approve tx if it falls short.
 */
async function ensureAllowance(args: {
  walletClient: WalletClient;
  pub: ReturnType<typeof createPublicClient>;
  token: Address;
  owner: Address;
  spender: Address;
  amount: bigint;
}): Promise<void> {
  const { walletClient, pub, token, owner, spender, amount } = args;
  const current = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint;
  if (current >= amount) return;
  const hash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
    account: walletClient.account!,
    chain: walletClient.chain,
  });
  await pub.waitForTransactionReceipt({ hash });
}

export function useFunding() {
  async function fund(args: FundArgs): Promise<bigint> {
    const { escrow } = getAddresses();
    if (!escrow) throw new Error('ESCROW_ADDRESS not set');
    const { walletClient } = args;
    if (!walletClient.account) throw new Error('wallet not connected');
    const account = walletClient.account;

    const pub = createPublicClient({ transport: http(RPC) });

    // 1. Read the listing's payToken (the ERC20 the buyer must lock).
    const listing = (await pub.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'getListing',
      args: [args.listingId],
    })) as readonly [Address, bigint, number, Address, boolean];
    const payToken = listing[3];
    const active = listing[4];
    if (!active) throw new Error('listing is not active');

    // 2. LIVE: pull USDC into the buyer's wallet in one tap before funding.
    //    (MOCK skips this — anvil accounts already hold the MockERC20 balance.)
    if (USE_BLINK) {
      await blinkPullDeposit({
        address: account.address,
        token: payToken,
        tokenAmount: args.tokenAmount,
      });
    }

    // 3. Ensure ERC20 allowance, then fund.
    await ensureAllowance({
      walletClient,
      pub,
      token: payToken,
      owner: account.address,
      spender: escrow,
      amount: args.tokenAmount,
    });

    const hash = await walletClient.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'fund',
      args: [args.listingId, args.tokenAmount, args.freeCancelUntil, args.expiry],
      account,
      chain: walletClient.chain,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });

    // 4. Parse the dealId out of the Funded event.
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'Funded') {
          return (decoded.args as { dealId: bigint }).dealId;
        }
      } catch {
        /* not one of our events */
      }
    }
    throw new Error('fund tx mined but no Funded event found');
  }

  return { fund };
}

export function FundButton(
  props: FundArgs & {
    onFunded: (dealId: bigint) => void;
    onError?: (e: unknown) => void;
  },
) {
  const { fund } = useFunding();
  const [busy, setBusy] = React.useState(false);

  const onClick = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dealId = await fund({
        listingId: props.listingId,
        tokenAmount: props.tokenAmount,
        freeCancelUntil: props.freeCancelUntil,
        expiry: props.expiry,
        walletClient: props.walletClient,
      });
      props.onFunded(dealId);
    } catch (e) {
      props.onError?.(e);
    } finally {
      setBusy(false);
    }
  }, [busy, props]);

  return (
    <button onClick={onClick} disabled={busy} aria-busy={busy}>
      {busy ? 'Funding…' : USE_BLINK ? 'Fund with Blink (one tap)' : 'Fund (one tap)'}
    </button>
  );
}
