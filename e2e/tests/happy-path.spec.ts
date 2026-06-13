// e2e/tests/happy-path.spec.ts — SPEC §16 demo happy path in the browser, with
// NEXT_PUBLIC_MOCK=true against local anvil. In mock mode the wallet is anvil
// account 0, which is both seller and buyer (self-deal); the deal page shows both
// action sets, so a single session can drive the whole flow.
//
//   /sell: list $80 / 10% deposit -> /buy/N: one-tap fund $88 -> "safe to meet"
//   -> /deal/N: seller checkIn -> reveal QR code -> buyer paste code -> Release
//   -> Confirm receipt -> Completed.
//
// Requires the stack up: anvil + deploy (scripts/deploy.sh) then Playwright boots apps/web.

import { test, expect } from '@playwright/test';

test.describe('happy path (list -> fund -> checkIn -> release -> Completed)', () => {
  test('completes an in-person handoff end to end', async ({ page }) => {
    test.setTimeout(300_000);

    // 1. Sell: create a listing (mock auto-connects as anvil acct 0).
    await page.goto('/sell');
    await page.locator('#price').fill('80');
    await page.getByRole('button', { name: '10%' }).click();
    await page.getByRole('button', { name: /create listing/i }).click();

    // 2. Grab the /buy/N link the success note renders.
    const buyLink = page.getByRole('link', { name: /\/buy\/\d+/ });
    await expect(buyLink).toBeVisible({ timeout: 30_000 });
    const href = await buyLink.getAttribute('href');
    expect(href).toMatch(/\/buy\/\d+/);

    // 3. Buy: see the $80 price + deposit policy, then one-tap fund.
    await page.goto(href!);
    await expect(page.getByText(/\$80/).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /fund/i }).click();

    // 4. Seller-verifiable "funds committed / safe to meet".
    await expect(page.getByText(/safe to meet|funds committed/i).first()).toBeVisible({
      timeout: 120_000,
    });

    // 5. Go to the deal.
    await page.getByRole('link', { name: /go to the deal/i }).click();
    await expect(page.getByRole('heading', { name: /deal #\d+/i })).toBeVisible({ timeout: 60_000 });

    // 6. Seller checks in, then reveals the one-time handoff code.
    await page.getByRole('button', { name: /check in/i }).click();
    await page.getByText(/show code as text/i).click({ timeout: 90_000 });
    const code = (await page.locator('code').first().innerText()).trim();
    expect(code.length).toBeGreaterThan(0);

    // 7. Buyer pastes the code -> Release -> Confirm receipt.
    await page.getByPlaceholder('paste handoff code').fill(code);
    await page.getByRole('button', { name: /^release$/i }).click();
    await page.getByRole('button', { name: /confirm receipt/i }).click();

    // 8. Completed (seller paid $80, deposit returned).
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test('app loads in mock mode without a Dynamic/Blink account', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByRole('link', { name: /sell an item/i })).toBeVisible();
  });
});
