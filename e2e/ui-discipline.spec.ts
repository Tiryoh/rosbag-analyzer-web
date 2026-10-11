import { test, expect, type Locator, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Guardrails for ADR 0012 (UI interaction discipline): entrance motion,
 * reduced-motion overrides, and instant focus-visible rings on shared
 * control classes.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');

async function uploadBag(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

function animationName(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).animationName);
}

test.describe('Entrance motion', () => {
  test('header uses the spatial fade-in by default', async ({ page }) => {
    await page.goto('/');
    expect(await animationName(page.locator('header'))).toBe('fadeIn');
  });

  test('reduced motion collapses the entrance to an opacity-only fade', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await animationName(page.locator('header'))).toBe('fadeInReduced');
  });

  test('conditionally rendered sections do not replay an entrance animation', async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    const filterCard = page.locator('.card').filter({ hasText: 'Filters' });
    await expect(filterCard).toBeVisible();
    expect(await animationName(filterCard)).toBe('none');
  });
});

test.describe('Focus-visible rings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    // Establish keyboard modality so programmatic focus matches :focus-visible.
    await page.keyboard.press('Tab');
  });

  const cases: Array<[string, (page: Page) => Locator]> = [
    ['.btn-chip (tab)', (page) => page.getByTestId('rosout-tab')],
    ['.btn-secondary (clear all)', (page) => page.getByRole('button', { name: 'Clear Filters' })],
    ['.input-field (node search)', (page) => page.locator('input.input-field').first()],
    ['.input-check (radio)', (page) => page.locator('input.input-check[type="radio"]').first()],
  ];

  for (const [label, getTarget] of cases) {
    test(`${label} shows a ring immediately on keyboard focus`, async ({ page }) => {
      const target = getTarget(page);
      await target.focus();
      const style = await target.evaluate((el) => {
        const cs = getComputedStyle(el);
        // Pair each transitioned property with its duration; the CSS initial
        // value (`all` / `0s`) means nothing animates.
        const props = cs.transitionProperty.split(',').map((s) => s.trim());
        const durations = cs.transitionDuration.split(',').map((s) => parseFloat(s));
        const animated = props.filter((_, i) => durations[i % durations.length] > 0);
        return {
          focusVisible: el.matches(':focus-visible'),
          boxShadow: cs.boxShadow,
          animated,
        };
      });
      expect(style.focusVisible).toBe(true);
      expect(style.boxShadow).not.toBe('none');
      // The ring must not fade in: box-shadow is never a transitioned property.
      expect(style.animated).not.toContain('box-shadow');
      expect(style.animated).not.toContain('all');
    });
  }
});
