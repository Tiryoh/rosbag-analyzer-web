import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample_truncated.mcap');

/**
 * Helper: upload the truncated MCAP file.
 */
async function uploadTruncatedMcap(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FIXTURE_PATH);
}

// ---------------------------------------------------------------------------
// MT-1. Truncated MCAP file handling
// ---------------------------------------------------------------------------
test.describe('Truncated MCAP file', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('MT-1-1: gracefully handles truncated mcap file', async ({ page }) => {
    await uploadTruncatedMcap(page);
    // The truncated file should either:
    // - Load partial data (streaming reader recovers some records)
    // - Show an error message
    // Wait for either outcome
    const loaded = page.getByText(/Loaded.*rosout messages/).first();
    const errorHeading = page.getByText('Error loading bag file');
    await expect(loaded.or(errorHeading)).toBeVisible({ timeout: 15000 });
  });

  test('MT-1-2: app remains functional after truncated file', async ({ page }) => {
    await uploadTruncatedMcap(page);
    // Wait for processing to complete
    const loaded = page.getByText(/Loaded.*rosout messages/).first();
    const errorHeading = page.getByText('Error loading bag file');
    await expect(loaded.or(errorHeading)).toBeVisible({ timeout: 15000 });

    // Verify the app is still responsive - title should be visible
    await expect(page.getByText('ROSbag Analyzer')).toBeVisible();
  });

  test('MT-1-3: can load a valid file after truncated file', async ({ page }) => {
    // First load truncated file
    await uploadTruncatedMcap(page);
    const loaded = page.getByText(/Loaded.*rosout messages/).first();
    const errorHeading = page.getByText('Error loading bag file');
    await expect(loaded.or(errorHeading)).toBeVisible({ timeout: 15000 });

    // Then load the valid mcap file
    const validPath = path.resolve(__dirname, 'fixtures/test_sample.mcap');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(validPath);
    await expect(page.getByText(/Loaded 10 rosout messages/)).toBeVisible({ timeout: 15000 });
  });
});
