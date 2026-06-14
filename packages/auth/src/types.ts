// Shared auth shapes (SPEC §7 — frozen contract the web app depends on).

export interface AuthState {
  ready: boolean;
  isConnected: boolean;
  address?: `0x${string}`;
  email?: string;
  login: () => void;
  logout: () => void;
}
