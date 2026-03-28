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

// --- MCAP file upload ---
test.describe('MCAP file upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('loads rosout messages', async ({ page }) => {
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible();
  });

  test('detects diagnostics', async ({ page }) => {
    await expect(page.getByText(/diagnostics state changes/)).toBeVisible();
  });

  test('shows tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Rosout/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Diagnostics/ })).toBeVisible();
  });
});

// --- MCAP severity mapping ---
test.describe('MCAP severity mapping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('severity levels are correctly mapped', async ({ page }) => {
    // Check all severity levels appear in the table
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(10);

    // Check that ROS2 severities (10,20,30,40,50) are mapped to names
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      await expect(page.locator('table tbody td', { hasText: level }).first()).toBeVisible();
    }
  });

  test('severity color coding', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    const rowClass = await firstRow.getAttribute('class');
    expect(rowClass).toBeTruthy();
    expect(rowClass).toMatch(/bg-/);
  });
});

// --- MCAP rosout filters ---
test.describe('MCAP rosout filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('severity filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // 2 ERROR messages
  });

  test('node filter', async ({ page }) => {
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3); // 3 lidar messages
  });

  test('keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('timeout');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // "Connection timeout" + "System watchdog timeout"
  });

  test('regex filter', async ({ page }) => {
    await page.getByText('Regex').click();
    await page.locator('input[type="text"][placeholder*="error"]').fill('find.*path');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // "Failed to find valid path"
  });

  test('AND mode', async ({ page }) => {
    await page.getByLabel('AND (All match)').check();
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // Only lidar ERROR
  });

  test('clear filters', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });
});

// --- MCAP rosout export ---
test.describe('MCAP rosout export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
  });

  test('CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('JSON export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('TXT export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
  });
});

// --- MCAP diagnostics ---
test.describe('MCAP diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadMcap(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('diagnostics table visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Diagnostics State Changes/ })).toBeVisible();
  });

  test('level filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('name filter', async ({ page }) => {
    await page.getByRole('checkbox', { name: '/sensor/lidar' }).check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    // MCAP fixture includes the initial OK state as a state change (unlike bag
    // where the first occurrence is not counted), so lidar has 4 entries:
    // OK → OK (no change, but present) → ERROR → STALE
    await expect(rows).toHaveCount(4);
  });

  test('keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('temperature');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('row expand shows values', async ({ page }) => {
    const toggleButton = page.locator('table tbody button[aria-expanded]').first();
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('frequency')).toBeVisible();
  });

  test('diagnostics CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});
