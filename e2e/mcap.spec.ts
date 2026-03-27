import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.mcap');

/**
 * Helper: upload the test MCAP file and wait for it to load.
 */
async function uploadMcap(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// M-1. MCAP file upload
// ---------------------------------------------------------------------------
test.describe('MCAP file upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('M-1-1: loads rosout messages', async ({ page }) => {
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible();
  });

  test('M-1-2: detects diagnostics', async ({ page }) => {
    await expect(page.getByText(/diagnostics state changes/)).toBeVisible();
  });

  test('M-1-3: shows tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Rosout/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Diagnostics/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// M-2. MCAP rosout severity mapping
// ---------------------------------------------------------------------------
test.describe('MCAP severity mapping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('M-2-1: severity levels are correctly mapped', async ({ page }) => {
    // Check all severity levels appear in the table
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(10);

    // Check that ROS2 severities (10,20,30,40,50) are mapped to names
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      await expect(page.locator('table tbody td', { hasText: level }).first()).toBeVisible();
    }
  });

  test('M-2-2: severity color coding', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    const rowClass = await firstRow.getAttribute('class');
    expect(rowClass).toBeTruthy();
    expect(rowClass).toMatch(/bg-/);
  });
});

// ---------------------------------------------------------------------------
// M-3. MCAP rosout filters
// ---------------------------------------------------------------------------
test.describe('MCAP rosout filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('M-3-1: severity filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // 2 ERROR messages
  });

  test('M-3-2: node filter', async ({ page }) => {
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3); // 3 lidar messages
  });

  test('M-3-3: keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('timeout');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // "Connection timeout" + "System watchdog timeout"
  });

  test('M-3-4: regex filter', async ({ page }) => {
    await page.getByText('Regex').click();
    await page.locator('input[type="text"][placeholder*="error"]').fill('find.*path');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // "Failed to find valid path"
  });

  test('M-3-5: AND mode', async ({ page }) => {
    await page.getByLabel('AND (All match)').check();
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // Only lidar ERROR
  });

  test('M-3-6: clear filters', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });
});

// ---------------------------------------------------------------------------
// M-4. MCAP rosout export
// ---------------------------------------------------------------------------
test.describe('MCAP rosout export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('M-4-1: CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('M-4-2: JSON export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('M-4-3: TXT export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
  });
});

// ---------------------------------------------------------------------------
// M-5. MCAP diagnostics
// ---------------------------------------------------------------------------
test.describe('MCAP diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('M-5-1: diagnostics table visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Diagnostics State Changes/ })).toBeVisible();
  });

  test('M-5-2: level filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('M-5-3: name filter', async ({ page }) => {
    await page.getByRole('checkbox', { name: '/sensor/lidar' }).check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    // MCAP fixture includes the initial OK state as a state change (unlike bag
    // where the first occurrence is not counted), so lidar has 4 entries:
    // OK → OK (no change, but present) → ERROR → STALE
    await expect(rows).toHaveCount(4);
  });

  test('M-5-4: keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('temperature');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('M-5-5: row expand shows values', async ({ page }) => {
    const toggleButton = page.locator('table tbody button[aria-expanded]').first();
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('frequency')).toBeVisible();
  });

  test('M-5-6: diagnostics CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});
