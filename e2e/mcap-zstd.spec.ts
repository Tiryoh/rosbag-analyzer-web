import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.mcap.zstd');

/**
 * Helper: upload the test MCAP.zstd file and wait for it to load.
 */
async function uploadMcapZstd(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// MZ-1. MCAP.zstd file upload
// ---------------------------------------------------------------------------
test.describe('MCAP.zstd file upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcapZstd(page);
  });

  test('MZ-1-1: loads rosout messages from zstd-compressed mcap', async ({ page }) => {
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible();
  });

  test('MZ-1-2: detects diagnostics', async ({ page }) => {
    await expect(page.getByText(/diagnostics state changes/)).toBeVisible();
  });

  test('MZ-1-3: shows tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Rosout/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Diagnostics/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// MZ-2. MCAP.zstd rosout severity mapping (same data as uncompressed)
// ---------------------------------------------------------------------------
test.describe('MCAP.zstd severity mapping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcapZstd(page);
  });

  test('MZ-2-1: severity levels are correctly mapped', async ({ page }) => {
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(10);

    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      await expect(page.locator('table tbody td', { hasText: level }).first()).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// MZ-3. MCAP.zstd rosout filters
// ---------------------------------------------------------------------------
test.describe('MCAP.zstd rosout filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcapZstd(page);
  });

  test('MZ-3-1: severity filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);
  });

  test('MZ-3-2: node filter', async ({ page }) => {
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('MZ-3-3: keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('timeout');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);
  });
});

// ---------------------------------------------------------------------------
// MZ-4. MCAP.zstd export
// ---------------------------------------------------------------------------
test.describe('MCAP.zstd rosout export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcapZstd(page);
  });

  test('MZ-4-1: CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('MZ-4-2: JSON export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });
});

// ---------------------------------------------------------------------------
// MZ-5. MCAP.zstd diagnostics
// ---------------------------------------------------------------------------
test.describe('MCAP.zstd diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcapZstd(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('MZ-5-1: diagnostics table visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Diagnostics State Changes/ })).toBeVisible();
  });

  test('MZ-5-2: level filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('MZ-5-3: row expand shows values', async ({ page }) => {
    const toggleButton = page.locator('table tbody button[aria-expanded]').first();
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('frequency')).toBeVisible();
  });
});
