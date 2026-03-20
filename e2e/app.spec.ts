import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');

/**
 * Helper: upload the test bag file and wait for it to load.
 */
async function uploadBag(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// 1. Initial page
// ---------------------------------------------------------------------------
test.describe('Initial page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1-1: shows title', async ({ page }) => {
    await expect(page.getByText('ROSbag Analyzer')).toBeVisible();
  });

  test('1-1a: shows logo image', async ({ page }) => {
    const logo = page.getByRole('img', { name: 'ROSbag Analyzer' });
    await expect(logo).toBeVisible();
  });

  test('1-2: shows upload area', async ({ page }) => {
    await expect(page.getByText('Click to upload')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });

  test('1-3: filters are hidden before upload', async ({ page }) => {
    await expect(page.getByText('Filters')).not.toBeVisible();
  });

  test('1-4: message table is hidden before upload', async ({ page }) => {
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('1-5: footer is visible', async ({ page }) => {
    await expect(page.getByText('View source on GitHub')).toBeVisible();
    await expect(page.getByText('Works offline')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. File upload
// ---------------------------------------------------------------------------
test.describe('File upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('2-1: loads rosout messages', async ({ page }) => {
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible();
  });

  test('2-2: detects diagnostics', async ({ page }) => {
    await expect(page.getByText(/diagnostics state changes/)).toBeVisible();
  });

  test('2-3: shows tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Rosout/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Diagnostics/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Rosout filters
// ---------------------------------------------------------------------------
test.describe('Rosout filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('3-1: filter panel is visible', async ({ page }) => {
    await expect(page.getByText('Filters').first()).toBeVisible();
  });

  test('3-2: severity filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // 2 ERROR messages
  });

  test('3-3: node filter', async ({ page }) => {
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3); // 3 lidar messages
  });

  test('3-4: keyword filter', async ({ page }) => {
    await page.locator('input[type="text"]').fill('timeout');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // "Connection timeout" + "System watchdog timeout"
  });

  test('3-5: regex filter', async ({ page }) => {
    await page.getByText('Regex').click();
    await page.locator('input[type="text"]').fill('find.*path');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // "Failed to find valid path"
  });

  test('3-6: AND/OR mode toggle', async ({ page }) => {
    // Select ERROR severity + /sensor/lidar node in AND mode
    await page.getByLabel('AND (All match)').check();
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // Only lidar ERROR
  });

  test('3-7: clear filters', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('3-8: select all / clear nodes', async ({ page }) => {
    await page.getByRole('button', { name: 'select all' }).click();
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
    await page.getByRole('button', { name: 'clear', exact: true }).click();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Rosout statistics
// ---------------------------------------------------------------------------
test.describe('Rosout statistics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('4-1: show stats panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Statistics')).toBeVisible();
  });

  test('4-2: severity counts', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('By Severity')).toBeVisible();
  });

  test('4-3: top 5 nodes', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Top 5 Nodes')).toBeVisible();
  });

  test('4-4: hide stats panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Statistics')).toBeVisible();
    await page.getByRole('button', { name: 'Hide Stats' }).click();
    await expect(page.getByText('Statistics')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Rosout export
// ---------------------------------------------------------------------------
test.describe('Rosout export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('5-1: CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('5-2: JSON export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('5-3: TXT export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
  });
});

// ---------------------------------------------------------------------------
// 6. Rosout message table
// ---------------------------------------------------------------------------
test.describe('Rosout message table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('6-1: table headers', async ({ page }) => {
    for (const header of ['Time', 'Node', 'Level', 'Message']) {
      await expect(page.locator('th', { hasText: header }).first()).toBeVisible();
    }
  });

  test('6-2: displays messages', async ({ page }) => {
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('6-3: preview limit buttons', async ({ page }) => {
    // With 10 messages, all limits show the same count, but buttons exist
    for (const n of ['100', '500', '1000']) {
      await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
  });

  test('6-4: timezone toggle', async ({ page }) => {
    await page.getByRole('button', { name: 'Local' }).click();
    // After toggling, button text changes to UTC and timestamps contain "UTC"
    await expect(page.getByRole('button', { name: 'UTC' })).toBeVisible();
    await expect(page.locator('table tbody tr').first().locator('td').first()).toContainText('UTC');
  });

  test('6-5: severity color coding', async ({ page }) => {
    // Check that rows have severity background classes
    const firstRow = page.locator('table tbody tr').first();
    const rowClass = await firstRow.getAttribute('class');
    expect(rowClass).toBeTruthy();
    expect(rowClass).toMatch(/bg-/);
  });
});

// ---------------------------------------------------------------------------
// 7. Diagnostics tab
// ---------------------------------------------------------------------------
test.describe('Diagnostics tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('7-1: tab switch shows diagnostics table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Diagnostics State Changes/ })).toBeVisible();
  });

  test('7-2: filter panel is visible', async ({ page }) => {
    await expect(page.getByText('Filters').first()).toBeVisible();
  });

  test('7-3: level filter', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    // Only /sensor/lidar ERROR "Connection lost"
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('7-4: name filter', async ({ page }) => {
    await page.getByLabel('/sensor/lidar').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    // lidar has state changes: OK → ERROR → STALE = 3 entries
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('7-5: keyword filter', async ({ page }) => {
    await page.locator('input[type="text"]').fill('temperature');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1); // motor/left "High temperature"
  });

  test('7-6: clear filters', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    // All state changes back
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Diagnostics table
// ---------------------------------------------------------------------------
test.describe('Diagnostics table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('8-1: table headers', async ({ page }) => {
    for (const header of ['Time', 'Name', 'Level', 'Message']) {
      await expect(page.locator('th', { hasText: header }).first()).toBeVisible();
    }
  });

  test('8-2: row expand shows values', async ({ page }) => {
    // Click a row that has values
    await page.locator('table tbody tr').first().click();
    // Values should be visible (e.g. "frequency" key)
    await expect(page.getByText('frequency')).toBeVisible();
  });

  test('8-3: row collapse hides values', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    await expect(page.getByText('frequency')).toBeVisible();
    await firstRow.click();
    await expect(page.getByText('frequency')).not.toBeVisible();
  });

  test('8-4: preview limit buttons', async ({ page }) => {
    for (const n of ['100', '500', '1000']) {
      await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
  });

  test('8-5: timezone toggle', async ({ page }) => {
    await page.getByRole('button', { name: 'Local' }).click();
    await expect(page.getByRole('button', { name: 'UTC' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 9. Diagnostics export
// ---------------------------------------------------------------------------
test.describe('Diagnostics export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('9-1: CSV export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('9-2: JSON export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('9-3: TXT export', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
  });
});
