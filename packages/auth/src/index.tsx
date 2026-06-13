// STUB (foundation). AGENT 5 replaces with the real Dynamic embedded-wallet integration.
// Keep these exact exports (SPEC §7). Mock mode signs with anvil account 0.
import React from 'react';
import { createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const RPC = (globalThis as any)?.process?.env?.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';
const account = privateKeyToAccount(ANVIL_PK);
const mockWallet = createWalletClient({ account, transport: http(RPC) });

export function HandoffAuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useAuth() {
  return {
    ready: true,
    isConnected: true,
    address: account.address as `0x${string}`,
    email: 'demo@handoff.local',
    login: () => {},
    logout: () => {},
  };
}

export function useWalletClient(): WalletClient | undefined {
  return mockWallet;
}

export function AuthButton() {
  return <button>demo@handoff.local</button>;
}
