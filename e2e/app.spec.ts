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

// --- Initial page ---
test.describe('Initial page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows title', async ({ page }) => {
    await expect(page.getByText('ROSbag Analyzer')).toBeVisible();
  });

  test('shows logo image', async ({ page }) => {
    const logo = page.getByRole('img', { name: 'ROSbag Analyzer' });
    await expect(logo).toBeVisible();
  });

  test('shows upload area', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Click to upload' })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });

  test('filters are hidden before upload', async ({ page }) => {
    await expect(page.getByText('Filters')).not.toBeVisible();
  });

  test('message table is hidden before upload', async ({ page }) => {
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('footer is visible', async ({ page }) => {
    await expect(page.getByText('View source on GitHub')).toBeVisible();
    await expect(page.getByText('Works offline')).toBeVisible();
  });
});

// --- File upload ---
test.describe('File upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
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

// --- Rosout filters ---
test.describe('Rosout filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('filter panel is visible', async ({ page }) => {
    await expect(page.getByText('Filters').first()).toBeVisible();
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

  test('AND/OR mode toggle', async ({ page }) => {
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

  test('time range filter narrows messages', async ({ page }) => {
    const startInput = page.locator('input[type="datetime-local"]').first();
    await startInput.fill('2023-11-14T22:13:22');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(4); // 2.0, 2.5, 3.0, 3.5
  });

  test('fill data range button populates inputs', async ({ page }) => {
    await page.getByText('Fill data range').click();
    const startInput = page.locator('input[type="datetime-local"]').first();
    const endInput = page.locator('input[type="datetime-local"]').last();
    await expect(startInput).not.toHaveValue('');
    await expect(endInput).not.toHaveValue('');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('node search and select shown', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search..."]');
    await searchInput.fill('lidar');
    await page.getByRole('button', { name: 'select shown', exact: true }).click();
    await searchInput.clear();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(3); // 3 lidar messages
  });

  test('node search and deselect shown', async ({ page }) => {
    await page.getByRole('button', { name: 'select all', exact: true }).click();
    const searchInput = page.locator('input[placeholder="Search..."]');
    await searchInput.fill('sensor');
    await page.getByRole('button', { name: 'deselect shown', exact: true }).click();
    await searchInput.clear();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(5); // 10 - 5 sensor messages = 5
  });

  test('select all / clear nodes', async ({ page }) => {
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

// --- Rosout statistics ---
test.describe('Rosout statistics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('show stats panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Statistics')).toBeVisible();
  });

  test('severity counts', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('By Severity')).toBeVisible();
  });

  test('top 5 nodes', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Top 5 Nodes')).toBeVisible();
  });

  test('hide stats panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Show Stats' }).click();
    await expect(page.getByText('Statistics')).toBeVisible();
    await page.getByRole('button', { name: 'Hide Stats' }).click();
    await expect(page.getByText('Statistics')).not.toBeVisible();
  });
});

// --- Rosout export ---
test.describe('Rosout export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
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

  test('export ignoring time filter includes all rows', async ({ page }) => {
    const startInput = page.locator('input[type="datetime-local"]').first();
    await startInput.fill('2023-11-14T22:13:22');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(4);

    await page.getByText('Ignore time filter').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);

    const filePath = await download.path();
    const fs = await import('fs');
    const content = fs.readFileSync(filePath!, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(11); // 1 header + 10 data rows
  });
});

// --- Rosout message table ---
test.describe('Rosout message table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
  });

  test('table headers', async ({ page }) => {
    for (const header of ['Time', 'Node', 'Level', 'Message']) {
      await expect(page.locator('th', { hasText: header }).first()).toBeVisible();
    }
  });

  test('displays messages', async ({ page }) => {
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('preview limit buttons', async ({ page }) => {
    for (const n of ['100', '500', '1,000']) {
      await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
  });

  test('timezone toggle', async ({ page }) => {
    await page.getByRole('button', { name: 'Local' }).click();
    await expect(page.getByRole('button', { name: 'UTC' })).toBeVisible();
    await expect(page.locator('table tbody tr').first().locator('td').first()).toContainText('UTC');
  });

  test('timezone toggle preserves time filter', async ({ page }) => {
    await page.getByText('Fill data range').click();
    const startInput = page.locator('input[type="datetime-local"]').first();
    const valueBefore = await startInput.inputValue();
    expect(valueBefore).not.toBe('');

    await page.getByRole('button', { name: 'Local' }).click();
    const valueAfter = await startInput.inputValue();
    expect(valueAfter).not.toBe('');

    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('severity color coding', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    const rowClass = await firstRow.getAttribute('class');
    expect(rowClass).toBeTruthy();
    expect(rowClass).toMatch(/bg-/);
  });

  test('mobile table controls remain visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: /Messages/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '100', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Local' })).toBeVisible();
  });
});

// --- Diagnostics tab ---
test.describe('Diagnostics tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('tab switch shows diagnostics table', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Diagnostics State Changes/ })).toBeVisible();
  });

  test('filter panel is visible', async ({ page }) => {
    await expect(page.getByText('Filters').first()).toBeVisible();
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
    await expect(rows).toHaveCount(3);
  });

  test('keyword filter', async ({ page }) => {
    await page.locator('input[type="text"][placeholder*="error"]').fill('temperature');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(1);
  });

  test('clear filters', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear Filters' }).click();
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
  });
});

// --- Diagnostics table ---
test.describe('Diagnostics table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('table headers', async ({ page }) => {
    for (const header of ['Time', 'Name', 'Level', 'Message']) {
      await expect(page.locator('th', { hasText: header }).first()).toBeVisible();
    }
  });

  test('row expand shows values', async ({ page }) => {
    const toggleButton = page.locator('table tbody button[aria-expanded]').first();
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('frequency')).toBeVisible();
  });

  test('row collapse hides values', async ({ page }) => {
    const toggleButton = page.locator('table tbody button[aria-expanded]').first();
    await toggleButton.click();
    await expect(page.getByText('frequency')).toBeVisible();
    await toggleButton.click();
    await expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('frequency')).not.toBeVisible();
  });

  test('preview limit buttons', async ({ page }) => {
    for (const n of ['100', '500', '1,000']) {
      await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
  });

  test('timezone toggle', async ({ page }) => {
    await page.getByRole('button', { name: 'Local' }).click();
    await expect(page.getByRole('button', { name: 'UTC' })).toBeVisible();
  });
});

// --- Diagnostics export ---
test.describe('Diagnostics export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
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
