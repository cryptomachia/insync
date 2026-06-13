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

export function DynamicAuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: ENV_ID,
        walletConnectors: [EthereumWalletConnectors],
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
  }, [primaryWallet]);

  return client;
}
