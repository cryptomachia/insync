// Shared auth shapes (SPEC §7 — frozen contract; AGENT 8 depends on these).

export interface AuthState {
  ready: boolean;
  isConnected: boolean;
  address?: `0x${string}`;
  email?: string;
  login: () => void;
  logout: () => void;
}
