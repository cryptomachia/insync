// @handoff/auth — Dynamic embedded wallets (email login) with a local mock mode.
// Used by the web app: HandoffAuthProvider, useAuth(), useWalletClient(),
// AuthButton().
//
// With NEXT_PUBLIC_MOCK=true we use a deterministic local anvil wallet; otherwise
// (NEXT_PUBLIC_DYNAMIC_ENV_ID) the live Dynamic embedded wallet. MOCK is read once
// at module load and never changes during a session, so the conditional hook
// calls below are stable across renders.
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
