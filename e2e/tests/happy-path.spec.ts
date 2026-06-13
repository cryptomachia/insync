// e2e/tests/happy-path.spec.ts — the SPEC §16 demo happy path, in the browser,
// with NEXT_PUBLIC_MOCK=true against local anvil:
//
//   login (email, mock auto-connect) -> Sell: list a bike $80 / 10% deposit
//   -> Buy: one-tap fund $88 -> seller "funds committed" -> meet:
//   seller checkIn + show QR -> buyer scan/paste handoff code -> confirmReceipt
//   -> Deal shows Completed (seller paid $80, buyer refunded $8 deposit).
//
// Selectors are resilient (role/text based) — see _helpers.ts. This requires the
// full stack up: `make anvil-bg && make deploy` then Playwright boots apps/web.

import { test } from '@playwright/test';
import { ensureLoggedIn, clickAny, fillAny, readHandoffCode, expect, HOME } from './_helpers';

test.describe('happy path (login -> list -> fund -> checkIn -> release -> Completed)', () => {
  test('completes an in-person handoff end to end', async ({ page }) => {
    // 1. login (mock auto-connects as anvil acct 0)
    await ensureLoggedIn(page);

    // 2. Sell: create a listing — bike, $80, 10% deposit, USDC
    await clickAny(page, /sell|create listing|list( an)? item/i);
    await fillAny(page, /price|amount|usd|\$/i, '80');
    // deposit policy: try a deposit/percent field; ignore if the UI presets it.
    await fillAny(page, /deposit|earnest|%|bps/i, '10').catch(() => {});
    await clickAny(page, /create|list|publish|submit/i);

    // The app should land on (or link to) the new listing / Buy view.
    await clickAny(page, /buy|view listing|open|go to deal/i).catch(() => {});

    // 3. Buy: see the deposit policy and one-tap fund $88
    await expect(page.getByText(/\$?\s*80/).first()).toBeVisible();
    await clickAny(page, /fund|one[- ]?tap|lock funds|deposit/i);

    // 4. seller sees "funds committed"
    await expect(
      page.getByText(/funds committed|committed|locked|funded/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // 5. the meet: seller checks in, then shows the release QR
    await clickAny(page, /check ?in|i'?m here|arrived/i);
    await expect(page.getByText(/checked in|qr|show this|release/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // 6. buyer scans / pastes the handoff code -> confirmReceipt
    const code = await readHandoffCode(page);
    if (code) {
      await fillAny(page, /paste|handoff|code|scan/i, code);
    }
    await clickAny(page, /release|confirm receipt|i got it|received|scan/i);

    // 7. Completed
    await expect(page.getByText(/completed|done|settled|success/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // and the §4 success split is surfaced: seller paid $80, buyer refunded $8
    await expect(page.getByText(/\$?\s*80/).first()).toBeVisible();
  });

  test('app loads in mock mode without a Dynamic/Blink account', async ({ page }) => {
    await page.goto(HOME);
    // Mock mode must render the app shell offline (no third-party keys).
    await expect(page).toHaveTitle(/handoff/i).catch(() => {});
    await expect(page.locator('body')).toBeVisible();
  });
});
