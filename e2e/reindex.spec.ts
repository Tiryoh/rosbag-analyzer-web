import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_unindexed.bag');

/**
 * Helper: upload the unindexed test bag file and wait for it to load.
 */
async function uploadUnindexedBag(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 30000 });
}

test.describe('Unindexed bag reindex', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads unindexed bag file successfully', async ({ page }) => {
    await uploadUnindexedBag(page);
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible();
  });

  test('shows reindex notice', async ({ page }) => {
    await uploadUnindexedBag(page);
    await expect(page.getByTestId('reindex-notice')).toBeVisible();
    await expect(page.getByTestId('reindex-warning')).not.toBeVisible();
  });

  test('shows download reindexed bag button', async ({ page }) => {
    await uploadUnindexedBag(page);
    await expect(page.getByTestId('download-reindexed')).toBeVisible();
  });

  test('can download reindexed bag', async ({ page }) => {
    await uploadUnindexedBag(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-reindexed').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.bag$/);
  });

  test('displays rosout messages in table', async ({ page }) => {
    await uploadUnindexedBag(page);
    await expect(page.locator('table tbody tr')).toHaveCount(10);
  });

  test('detects diagnostics from unindexed bag', async ({ page }) => {
    await uploadUnindexedBag(page);
    await expect(page.getByText(/diagnostics state changes/)).toBeVisible();
  });

  test('filters work on reindexed bag', async ({ page }) => {
    await uploadUnindexedBag(page);
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2); // 2 ERROR messages in fixture
  });

  test('reindex notice not shown for indexed bag', async ({ page }) => {
    const indexedPath = path.resolve(__dirname, 'fixtures/test_sample.bag');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(indexedPath);
    await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('reindex-notice')).not.toBeVisible();
  });
});

// --- Truncated bag (crashed recording simulation) ---
test.describe('Truncated bag reindex', () => {
  const TRUNCATED_PATH = path.resolve(__dirname, 'fixtures/test_truncated.bag');

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads truncated bag with partial data', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TRUNCATED_PATH);

    await expect(page.getByTestId('error-panel')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('reindex-blockers')).toBeVisible();
  });

  test('does not crash the page', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(TRUNCATED_PATH);

    await expect(page.getByTestId('error-panel')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('reindex-blocker-item')).toHaveCount(1);

    // Page should still be functional — upload area should remain
    await expect(page.getByRole('button', { name: 'Click to upload' })).toBeVisible();
  });
});
