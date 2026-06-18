// Write transactions to the Escrow, signed by the wallet client from @handoff/auth.
// Funding goes through @handoff/funding (FundButton/useFunding); these cover the rest of the
// lifecycle: list / checkIn / confirmReceipt / agreeCancel / buyerCancel. (SPEC §3, §10)
import { parseAbi, type WalletClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import { escrowAbi, getAddresses } from '@handoff/contracts-abi';
import { getReport } from '@handoff/datastreams';
import { publicClient, chain } from './chain';
import { isStableToken } from './format';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8787';
const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

// Make sure `owner` holds + has approved `amount` of `token` for the escrow (used for the seller
// bond at list time). Tops up from the test-USDC faucet if short. Mirrors the buyer fund path.
async function ensureSpendable(
  wc: WalletClient,
  token: `0x${string}`,
  owner: `0x${string}`,
  amount: bigint,
) {
  const pub = publicClient();
  const bal = () =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>;
  let have = await bal();
  if (have < amount) {
    await fetch(`${BACKEND_URL}/faucet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: owner }),
    }).catch(() => {});
    for (let i = 0; i < 25 && have < amount; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      have = await bal();
    }
    if (have < amount) throw new Error('Not enough test USDC for the no-show bond — try again in a moment.');
  }
  const allowance = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, escrowAddr()],
  })) as bigint;
  if (allowance < amount) {
    const hash = await wc.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [escrowAddr(), amount],
      account: wc.account!,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash });
  }
}

function escrowAddr(): `0x${string}` {
  const { escrow } = getAddresses();
  if (!escrow) throw new Error('NEXT_PUBLIC_ESCROW_ADDRESS not set');
  return escrow;
}

function requireAccount(wc: WalletClient) {
  if (!wc.account) throw new Error('Wallet not connected');
  return wc.account;
}

// Wallets (especially injected ones) can be on the wrong network. Make sure we're on the
// app's chain before signing — switch to it, adding it to the wallet if it's unknown.
async function ensureChain(wc: WalletClient) {
  let current: number | undefined;
  try {
    current = await wc.getChainId();
  } catch {
    /* ignore — try to switch anyway */
  }
  if (current === chain.id) return;
  try {
    await wc.switchChain({ id: chain.id });
  } catch {
    try {
      await wc.addChain({ chain: chain.id === baseSepolia.id ? baseSepolia : chain });
      await wc.switchChain({ id: chain.id });
    } catch {
      throw new Error(
        `Please switch your wallet to ${chain.name ?? 'the right network'} (chain ${chain.id}) and try again.`,
      );
    }
  }
}

async function send(wc: WalletClient, fn: () => Promise<`0x${string}`>) {
  const hash = await fn();
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

/** Seller creates a listing. Returns the listingId parsed from the Listed event. */
export async function listItem(
  wc: WalletClient,
  args: {
    priceUsd1e8: bigint;
    depositBps: number;
    payToken: `0x${string}`;
    // Seller-set cancellation timing policy (seconds from funding).
    freeCancelWindow: bigint;
    dealTtl: bigint;
    // Seller no-show bond (payToken units) staked now; forfeited to the buyer if the seller ghosts.
    bondAmount: bigint;
  },
): Promise<bigint> {
  const account = requireAccount(wc);
  await ensureChain(wc);
  // Stake the bond up front (approve + top up if needed) before listing.
  if (args.bondAmount > 0n) {
    await ensureSpendable(wc, args.payToken, account.address, args.bondAmount);
  }
  const hash = await wc.writeContract({
    address: escrowAddr(),
    abi: escrowAbi,
    functionName: 'list',
    args: [args.priceUsd1e8, args.depositBps, args.payToken, args.freeCancelWindow, args.dealTtl, args.bondAmount],
    account,
    chain,
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  // Parse listingId from the Listed event.
  const { decodeEventLog } = await import('viem');
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: escrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Listed') {
        return (decoded.args as { listingId: bigint }).listingId;
      }
    } catch {
      /* not our event */
    }
  }
  return 0n;
}

/** Seller withdraws an unfunded listing and gets the staked bond back. */
export async function cancelListing(wc: WalletClient, listingId: bigint) {
  const account = requireAccount(wc);
  await ensureChain(wc);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'cancelListing',
      args: [listingId],
      account,
      chain,
    }),
  );
}

/** Seller checks in at the meet (gates forfeiture). */
export async function checkIn(wc: WalletClient, dealId: bigint) {
  const account = requireAccount(wc);
  await ensureChain(wc);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'checkIn',
      args: [dealId],
      account,
      chain,
    }),
  );
}

/**
 * Buyer confirms receipt (success path). For a volatile payToken we fetch a Data Streams
 * report and pass it in; for the stable token (USDC) an empty report is fine. (SPEC §6/§10)
 */
export async function confirmReceipt(
  wc: WalletClient,
  dealId: bigint,
  payToken: `0x${string}`,
) {
  const account = requireAccount(wc);
  await ensureChain(wc);
  const report = await reportFor(payToken);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'confirmReceipt',
      args: [dealId, report],
      account,
      chain,
    }),
  );
}

/** Seller co-signs a cancel -> full refund to buyer. */
export async function agreeCancel(wc: WalletClient, dealId: bigint) {
  const account = requireAccount(wc);
  await ensureChain(wc);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'agreeCancel',
      args: [dealId],
      account,
      chain,
    }),
  );
}

/** Buyer cancels -> outcome per §4 (report needed only for volatile tokens). */
export async function buyerCancel(
  wc: WalletClient,
  dealId: bigint,
  payToken: `0x${string}`,
) {
  const account = requireAccount(wc);
  await ensureChain(wc);
  const report = await reportFor(payToken);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'buyerCancel',
      args: [dealId, report],
      account,
      chain,
    }),
  );
}

async function reportFor(payToken: `0x${string}`): Promise<`0x${string}`> {
  // USDC (the configured stable) needs no oracle — empty report (SPEC §6).
  if (isStableToken(payToken)) return '0x';
  // Volatile token: a signed Data Streams report is required.
  //
  // MOCK mode: getReport short-circuits to '0x' (the contract's MockVerifier accepts
  // it), so this is safe to call from the client during the demo.
  //
  // PRODUCTION HARDENING (live mode): getReport's live branch reads server-only
  // secrets (CHAINLINK_DATASTREAMS_API_KEY/SECRET) which are intentionally NOT
  // NEXT_PUBLIC_ and never inlined into the client bundle. Fetching a live report
  // MUST therefore happen server-side — add an API route (e.g. /api/datastreams-report,
  // runtime='nodejs') that calls getReport and returns the blob, and have this client
  // call that route. Calling getReport directly here in live mode would throw
  // (missing creds client-side) by design — it never leaks the secret.
  const feed = process.env.NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD ?? 'ETH/USD';
  return getReport(feed);
}
