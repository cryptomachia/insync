// e2e/tests/cancel.spec.ts — a §4 CANCEL branch in the browser (mock mode).
//
// Buyer-friendly free-window cancel: buyer funds, then cancels BEFORE
// freeCancelUntil -> full refund (price + deposit), deal shows Refunded.
// ("changed my mind before we met — get everything back".)
//
// The full §4 matrix (forfeiture + reclaim) is covered deterministically in
// scripts/contract-e2e.ts; this UI test proves the cancel action is wired through.

import { test, expect } from '@playwright/test';

test.describe('cancel branch (buyerCancel within free window -> full refund)', () => {
  test('buyer cancels before the free window and is fully refunded', async ({ page }) => {
    test.setTimeout(120_000);

    // list -> capture buy link -> fund
    await page.goto('/sell');
    await page.locator('#price').fill('80');
    await page.getByRole('button', { name: '10%' }).click();
    await page.getByRole('button', { name: /create listing/i }).click();

    const buyLink = page.getByRole('link', { name: /\/buy\/\d+/ });
    await expect(buyLink).toBeVisible({ timeout: 30_000 });
    const href = await buyLink.getAttribute('href');
    await page.goto(href!);

    await page.getByRole('button', { name: /fund/i }).click();
    await expect(page.getByText(/safe to meet|funds committed/i).first()).toBeVisible({
      timeout: 45_000,
    });

    // go to the deal, open the buyer cancel section, cancel within the free window
    await page.getByRole('link', { name: /go to the deal/i }).click();
    await expect(page.getByRole('heading', { name: /deal #\d+/i })).toBeVisible({ timeout: 20_000 });
    await page.getByText(/cancel instead/i).click(); // opens the buyer <details>
    await page.getByRole('button', { name: /cancel my purchase/i }).click();

    // terminal: Refunded (buyer got everything back)
    await expect(page.getByText(/refunded/i).first()).toBeVisible({ timeout: 45_000 });
  });
});
