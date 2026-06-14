// Live Dynamic embedded-wallet integration (NEXT_PUBLIC_DYNAMIC_ENV_ID).
// Email login via Dynamic; useWalletClient returns a viem WalletClient backed
// by the embedded wallet. Docs: https://www.dynamic.xyz/docs
import React from 'react';
import {
  DynamicContextProvider,
  useDynamicContext,
} from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum';
import type { WalletClient } from 'viem';
import type { AuthState } from './types';

// Reference process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID LITERALLY so Next inlines it into
// the browser bundle. A `globalThis.process.env[...]` indirection is NOT statically
// replaced, so it reads undefined client-side and Dynamic mounts with no environmentId.
const ENV_ID = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID ?? '';
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '84532');
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com';

// Dynamic only allows chains explicitly listed in its "supportedNetworks". The app runs on
// Base Sepolia, which isn't a Dynamic default — register it so requests to 84532 are allowed.
const baseSepoliaNetwork = {
  blockExplorerUrls: ['https://sepolia.basescan.org'],
  chainId: CHAIN_ID,
  chainName: 'Base Sepolia',
  iconUrls: ['https://app.dynamic.xyz/assets/networks/base.svg'],
  name: 'Base Sepolia',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  networkId: CHAIN_ID,
  rpcUrls: [RPC_URL],
  vanityName: 'Base Sepolia',
};

// Append (don't replace) the dashboard networks, adding Base Sepolia if it's missing.
function evmNetworks(dashboard: Array<{ chainId?: number | string }> = []) {
  if (dashboard.some((n) => Number(n.chainId) === CHAIN_ID)) return dashboard;
  return [...dashboard, baseSepoliaNetwork];
}

export function DynamicAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: ENV_ID,
        walletConnectors: [EthereumWalletConnectors],
        overrides: { evmNetworks: evmNetworks as never },
        // We only need the wallet address — not a signed session/JWT — so connect WITHOUT
        // the default "Sign In With Ethereum" verification signature. This removes the extra
        // signature popup(s) on login; each on-chain action still signs its own tx.
        initialAuthenticationMode: 'connect-only',
      }}
    >
      {children}
    </DynamicContextProvider>
  );
}

export function useDynamicAuth(): AuthState {
  const { user, primaryWallet, sdkHasLoaded, setShowAuthFlow, handleLogOut } =
    useDynamicContext();

  return {
    ready: sdkHasLoaded,
    isConnected: !!primaryWallet,
    address: primaryWallet?.address as `0x${string}` | undefined,
    email: user?.email,
    login: () => setShowAuthFlow(true),
    logout: () => {
      void handleLogOut();
    },
  };
}

export function useDynamicWalletClient(): WalletClient | undefined {
  const { primaryWallet } = useDynamicContext();
  const [client, setClient] = React.useState<WalletClient | undefined>(undefined);
  // Dynamic can hand back a fresh `primaryWallet` object on every render; keying the effect
  // on the stable address (not the object) means we fetch the wallet client once per account
  // instead of re-initialising it on each re-render.
  const address = primaryWallet?.address;

  React.useEffect(() => {
    let cancelled = false;

    if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
      setClient(undefined);
      return;
    }

    primaryWallet
      .getWalletClient()
      .then((wc) => {
        if (!cancelled) setClient(wc as WalletClient);
      })
      .catch(() => {
        if (!cancelled) setClient(undefined);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  return client;
}
