'use client';

// Wraps the whole app in the Dynamic auth provider (SPEC §7/§10). In mock mode this is a
// pass-through that signs with anvil account 0; the real Dynamic provider drops in unchanged.
import { HandoffAuthProvider } from '@handoff/auth';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <HandoffAuthProvider>{children}</HandoffAuthProvider>;
}
