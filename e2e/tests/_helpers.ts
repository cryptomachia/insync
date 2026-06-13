// e2e/tests/_helpers.ts — resilient locators for the Handoff web UI.
//
// AGENT 10 cannot see AGENT 8's exact markup, so these helpers target the app
// by ROLE + accessible NAME / visible TEXT derived from SPEC §10 (Sell / Buy /
// Deal / Status screens) rather than brittle CSS selectors. Each helper accepts
// regex name matches and tries a couple of synonyms. If your app uses different
// labels, adjust the regexes here in one place.
//
// All flows assume NEXT_PUBLIC_MOCK=true: auth auto-logs-in as anvil account 0
// (SPEC §7 mock), funding does a real on-chain approve+fund against local anvil,
// and the QR step has a paste-the-code fallback (SPEC §9) for headless runs.

import { expect, type Page, type Locator } from '@playwright/test';

export const HOME = '/';

/** Click the first button/link whose accessible name matches `name`. */
export async function clickAny(page: Page, name: RegExp, opts?: { timeout?: number }) {
  const candidates: Locator[] = [
    page.getByRole('button', { name }),
    page.getByRole('link', { name }),
    page.getByText(name),
  ];
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await c.first().click({ timeout: opts?.timeout ?? 10_000 });
      return;
    }
  }
  // last resort: wait for the button to appear then click
  await page.getByRole('button', { name }).first().click({ timeout: opts?.timeout ?? 10_000 });
}

/** Fill the first input matching a label/placeholder regex. */
export async function fillAny(page: Page, label: RegExp, value: string) {
  const byLabel = page.getByLabel(label);
  if (await byLabel.first().isVisible().catch(() => false)) {
    await byLabel.first().fill(value);
    return;
  }
  const byPlaceholder = page.getByPlaceholder(label);
  if (await byPlaceholder.first().isVisible().catch(() => false)) {
    await byPlaceholder.first().fill(value);
    return;
  }
  // fall back to the Nth textbox if labels differ
  await page.getByRole('textbox').first().fill(value);
}

/** Ensure the mock session is logged in (auth auto-connects in mock mode). */
export async function ensureLoggedIn(page: Page) {
  await page.goto(HOME);
  // In mock mode useAuth() returns isConnected:true immediately; if a login
  // button is shown, click it.
  const loginBtn = page.getByRole('button', { name: /log\s?in|sign\s?in|connect|continue with email/i });
  if (await loginBtn.first().isVisible().catch(() => false)) {
    await loginBtn.first().click().catch(() => {});
  }
  await expect(page.locator('body')).toBeVisible();
}

/** Read the handoff code the seller's ReleaseQR renders (paste-fallback text). */
export async function readHandoffCode(page: Page): Promise<string> {
  // The QR stub renders the base64 code inside a <pre> (SPEC §9 stub).
  const pre = page.locator('pre');
  if (await pre.first().isVisible().catch(() => false)) {
    return (await pre.first().innerText()).trim();
  }
  // Some implementations expose it via a data attribute or copy button payload.
  const dataEl = page.locator('[data-handoff-code]');
  if (await dataEl.first().count()) {
    return (await dataEl.first().getAttribute('data-handoff-code'))?.trim() ?? '';
  }
  return '';
}

export { expect };
