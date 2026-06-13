import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load root .env (written by scripts/deploy.sh) so NEXT_PUBLIC_* addresses are
// available to the web dev server Playwright launches.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const envFile = resolve(ROOT, '.env');
const env: Record<string, string> = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const WEB_DIR = resolve(ROOT, 'apps', 'web');
const WEB_PORT = process.env.WEB_PORT || '3000';
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${WEB_PORT}`;

// Reuse a server you already started (e.g. via `make dev`) if one is up; else
// Playwright boots `apps/web` in MOCK mode. Skip the managed server entirely
// when REUSE_SERVER=1 (CI may run the app separately) or the dir is absent.
const manageServer = process.env.REUSE_SERVER !== '1' && existsSync(WEB_DIR);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // these flows share on-chain state on a single anvil
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // mobile-first app (SPEC §10): default to a phone viewport.
    ...devices['Pixel 5'],
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 5'] } }],
  webServer: manageServer
    ? {
        command: 'npm run dev',
        cwd: WEB_DIR,
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: true,
        env: {
          ...env,
          NEXT_PUBLIC_MOCK: 'true',
          MOCK: 'true',
          NEXT_PUBLIC_RPC_URL: env.NEXT_PUBLIC_RPC_URL || env.RPC_URL || 'http://127.0.0.1:8545',
          PORT: WEB_PORT,
        },
      }
    : undefined,
});
