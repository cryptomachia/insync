// @handoff/auth — Dynamic embedded wallets (email login), with a local mock mode.
// SPEC §7. Exports are a FROZEN contract (AGENT 8 depends on them):
//   HandoffAuthProvider({ children })
//   useAuth()        -> { ready, isConnected, address?, email?, login, logout }
//   useWalletClient() -> viem WalletClient | undefined
//   AuthButton()
//
// Mode selection:
//   NEXT_PUBLIC_MOCK=true             -> deterministic local anvil wallet, no Dynamic account.
//   else (NEXT_PUBLIC_DYNAMIC_ENV_ID) -> live Dynamic embedded wallet.
//
// MOCK is read once at module load; it never changes during a session, so the
// branch below is stable and does not violate the rules of hooks.
import React from 'react';
import type { WalletClient } from 'viem';
import type { AuthState } from './types';
import { MockAuthProvider, useMockAuth, useMockWalletClient } from './mock';
import {
  DynamicAuthProvider,
  useDynamicAuth,
  useDynamicWalletClient,
} from './dynamic';

export type { AuthState } from './types';

// Reference process.env.NEXT_PUBLIC_MOCK LITERALLY so Next inlines it into the
// browser bundle (a `globalThis.process.env` indirection is not statically replaced,
// so it reads undefined client-side and the live Dynamic provider would mount).
const MOCK = process.env.NEXT_PUBLIC_MOCK === 'true';

export function HandoffAuthProvider({ children }: { children: React.ReactNode }) {
  if (MOCK) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }
  return <DynamicAuthProvider>{children}</DynamicAuthProvider>;
}

export function useAuth(): AuthState {
  // MOCK is a module constant: exactly one branch runs for the app's lifetime,
  // so this conditional hook call is stable across renders.
  if (MOCK) {
    return useMockAuth();
  }
  return useDynamicAuth();
}

export function useWalletClient(): WalletClient | undefined {
  if (MOCK) {
    return useMockWalletClient();
  }
  return useDynamicWalletClient();
}

export function AuthButton() {
  const { ready, isConnected, address, email, login, logout } = useAuth();

  if (!ready) {
    return <button disabled>Loading…</button>;
  }

  if (!isConnected) {
    return <button onClick={login}>Sign in with email</button>;
  }

  const label =
    email ?? (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connected');

  return <button onClick={logout}>{label}</button>;
}
