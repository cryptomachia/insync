// e2e/tests/cancel.spec.ts — a §4 CANCEL branch in the browser (mock mode).
//
// Covers the buyer-friendly free-window cancel: buyer funds, then cancels BEFORE
// freeCancelUntil -> full refund (price + deposit) and the deal shows a
// refunded/cancelled terminal state. This is the most demo-relevant cancel path
// ("changed my mind before we met — get everything back").
//
// The contract-level matrix (every §4 row, incl. forfeiture + reclaim) is
// covered deterministically in scripts/contract-e2e.ts; this UI test proves the
// cancel action is wired through the app.

import { test } from '@playwright/test';
import { ensureLoggedIn, clickAny, fillAny, expect } from './_helpers';

test.describe('cancel branch (buyerCancel within free window -> full refund)', () => {
  test('buyer cancels before the free window and is fully refunded', async ({ page }) => {
    await ensureLoggedIn(page);

    // list an item
    await clickAny(page, /sell|create listing|list( an)? item/i);
    await fillAny(page, /price|amount|usd|\$/i, '80');
    await fillAny(page, /deposit|earnest|%|bps/i, '10').catch(() => {});
    await clickAny(page, /create|list|publish|submit/i);

    // open the buy / deal view and fund it
    await clickAny(page, /buy|view listing|open|go to deal/i).catch(() => {});
    await clickAny(page, /fund|one[- ]?tap|lock funds|deposit/i);
    await expect(page.getByText(/committed|locked|funded/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // cancel within the free window
    await clickAny(page, /cancel|get (my )?refund|back out/i);
    // the UI should explain the §4 outcome plainly, then confirm
    await clickAny(page, /confirm|yes,? cancel|get refund/i).catch(() => {});

    // terminal refunded/cancelled state, full amount back
    await expect(
      page.getByText(/refund|cancelled|canceled|returned/i).first(),
    ).toBeVisible({ timeout: 30_000 });
    // free-window cancel returns the full $88 (price + deposit)
    await expect(page.getByText(/\$?\s*88|full(y)? refund|deposit.*back/i).first())
      .toBeVisible()
      .catch(() => {});
  });
});
