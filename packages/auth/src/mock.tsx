// Mock auth provider (NEXT_PUBLIC_MOCK=true).
// "Logs in" with a deterministic local anvil account and returns a real viem
// WalletClient for it, so the whole app runs with no Dynamic account.
import React from 'react';
import { createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { AuthState } from './types';

// Default: anvil account 0 (local dev). Override with NEXT_PUBLIC_MOCK_PK to drive a
// funded EOA against a live testnet (the standard anvil address is EIP-7702-delegated on
// some testnets and can't pay gas). Reference process.env literally so Next inlines it.
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const MOCK_PK = (process.env.NEXT_PUBLIC_MOCK_PK || ANVIL_PK) as `0x${string}`;
const RPC = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';

const account = privateKeyToAccount(MOCK_PK);
const mockWallet: WalletClient = createWalletClient({ account, transport: http(RPC) });

export function MockAuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useMockAuth(): AuthState {
  return {
    ready: true,
    isConnected: true,
    address: account.address as `0x${string}`,
    email: 'demo@handoff.local',
    login: () => {},
    logout: () => {},
  };
}

export function useMockWalletClient(): WalletClient | undefined {
  return mockWallet;
}
