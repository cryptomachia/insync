// Funding package (Blink one-tap USDC deposit). Exposes FundButton (the CTA) and
// useFunding().fund(args), used by the web app.
//
// fund() reads the listing's payToken, makes sure the buyer holds enough (via
// Blink when live+enabled, otherwise the test-USDC faucet), then approves the
// Escrow and calls fund(), resolving with the dealId from the Funded event. In
// mock mode it skips Blink and just approves + funds against anvil.
import React from 'react';
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
  type WalletClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { escrowAbi, getAddresses, IS_MOCK } from '@handoff/contracts-abi';

export type FundArgs = {
  listingId: bigint;
  tokenAmount: bigint;
  walletClient: WalletClient;
};

// Minimal ERC20 surface we need (allowance/approve). viem human-readable.
const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const norm = (v: string | undefined) => (v == null || v === '' ? undefined : v);

// Reference NEXT_PUBLIC_* literally so Next inlines them into the browser bundle (a
// `globalThis.process.env[...]` indirection reads undefined client-side and silently
// falls back to localhost — breaks live testnet reads/funding).
const RPC =
  norm(process.env.NEXT_PUBLIC_RPC_URL) ?? norm(process.env.RPC_URL) ?? 'http://127.0.0.1:8545';

const BLINK_MERCHANT_ID = norm(process.env.NEXT_PUBLIC_BLINK_MERCHANT_ID);
// Server signer route that holds the merchant private key (SPEC: docs.blink.cash/integration/signer-endpoint).
const BLINK_SIGNER_PATH = norm(process.env.NEXT_PUBLIC_BLINK_SIGNER_PATH) ?? '/api/sign-payment';
// Blink's hosted deposit is a browser SDK that can't be dynamically imported in our bundle, so
// it's OFF unless explicitly enabled. By default we top up the buyer from the test-USDC faucet.
const ENABLE_BLINK = process.env.NEXT_PUBLIC_ENABLE_BLINK === 'true';
const BACKEND_URL = norm(process.env.NEXT_PUBLIC_BACKEND_URL) ?? 'http://127.0.0.1:8787';
const CHAIN_ID = Number(
  norm(process.env.NEXT_PUBLIC_CHAIN_ID) ?? norm(process.env.CHAIN_ID) ?? '31337',
);

// viem refuses to send if the tx's `chain` differs from the wallet's active chain. The
// Dynamic wallet client reports a STALE `.chain` (mainnet) even after switching networks,
// so pass the real target chain explicitly. (undefined on anvil/local is fine — no guard.)
const targetChain = CHAIN_ID === baseSepolia.id ? baseSepolia : undefined;

// Live Blink only when explicitly enabled AND configured. Otherwise we top up via the
// test-USDC faucet and run the pure on-chain approve+fund path.
const USE_BLINK = !IS_MOCK && ENABLE_BLINK && !!BLINK_MERCHANT_ID;

/**
 * Top up the buyer's wallet with test USDC via the backend faucet, then wait for the
 * balance to reflect on-chain. Used in live testnet demo mode where the pay token is a
 * faucet-mintable test stablecoin.
 */
async function faucetTopUp(args: {
  pub: ReturnType<typeof createPublicClient>;
  token: Address;
  owner: Address;
  need: bigint;
}): Promise<void> {
  const { pub, token, owner, need } = args;
  await fetch(`${BACKEND_URL}/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: owner }),
  }).catch(() => {});
  for (let i = 0; i < 25; i++) {
    const bal = (await pub.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    })) as bigint;
    if (bal >= need) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Pull stablecoins into the buyer's wallet via Blink's one-tap hosted deposit.
 * The SDK is configured with the public merchantId + the server signer endpoint
 * (which signs the deposit request with the merchant private key). Lazy-imported so
 * mock builds need no Blink dep. Resolves when the deposit settles; throws on cancel.
 */
async function blinkPullDeposit(opts: {
  address: Address;
  token: Address;
  tokenAmount: bigint;
}): Promise<void> {
  // @ts-ignore -- optional live-only dependency; .catch handles absence (falls back to approve+fund)
  const mod: any = await import(/* webpackIgnore: true */ '@swype-org/deposit').catch(() => {
    throw new Error(
      'Blink live mode requires the @swype-org/deposit package. Install it or set NEXT_PUBLIC_MOCK=true.',
    );
  });
  const cfg = { merchantId: BLINK_MERCHANT_ID, signer: BLINK_SIGNER_PATH };
  const deposit = mod.createDeposit
    ? mod.createDeposit(cfg)
    : mod.Deposit
    ? new mod.Deposit(cfg)
    : mod.default?.(cfg);

  // Blink takes whole-USD amounts; the escrow's USDC is 6 decimals.
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
    chain: targetChain,
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

    // Ensure the wallet is on the app's chain before signing (injected wallets may differ).
    try {
      if ((await walletClient.getChainId()) !== CHAIN_ID) {
        await walletClient.switchChain({ id: CHAIN_ID });
      }
    } catch {
      try {
        await walletClient.addChain({
          chain:
            CHAIN_ID === baseSepolia.id
              ? baseSepolia
              : ({
                  id: CHAIN_ID,
                  name: `chain-${CHAIN_ID}`,
                  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                  rpcUrls: { default: { http: [RPC] } },
                } as never),
        });
        await walletClient.switchChain({ id: CHAIN_ID });
      } catch {
        throw new Error(`Switch your wallet to chain ${CHAIN_ID} (Base Sepolia) and try again.`);
      }
    }

    const pub = createPublicClient({ transport: http(RPC) });

    // 1. Read the listing's payToken (the ERC20 the buyer must lock).
    const listing = (await pub.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'getListing',
      args: [args.listingId],
    })) as readonly [Address, bigint, number, Address, boolean, bigint, bigint, bigint];
    const payToken = listing[3];
    const active = listing[4];
    if (!active) throw new Error('listing is not active');

    // 2. Make sure the buyer holds enough of the pay token. If short, pull funds via Blink
    //    (when enabled) and/or top up from the test-USDC faucet. A wallet that already holds
    //    enough skips straight to approve+fund — and pre-funding means the wallet can simulate
    //    the fund tx and show the expected balance change in its confirmation.
    const readBalance = async () =>
      (await pub.readContract({
        address: payToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      })) as bigint;

    let balance = await readBalance();
    if (balance < args.tokenAmount) {
      if (USE_BLINK) {
        try {
          await blinkPullDeposit({
            address: account.address,
            token: payToken,
            tokenAmount: args.tokenAmount,
          });
          balance = await readBalance();
        } catch {
          /* Blink unavailable — fall through to the faucet */
        }
      }
      if (balance < args.tokenAmount) {
        await faucetTopUp({ pub, token: payToken, owner: account.address, need: args.tokenAmount });
        balance = await readBalance();
      }
      if (balance < args.tokenAmount) {
        throw new Error(
          'Could not get enough test USDC into your wallet automatically. Try again in a moment.',
        );
      }
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
      args: [args.listingId, args.tokenAmount],
      account,
      chain: targetChain,
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
