import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');

// The SQL console only exists in builds with VITE_ENABLE_LLM=1.
// Run with: VITE_ENABLE_LLM=1 npx playwright test e2e/sql-console.spec.ts
test.skip(process.env.VITE_ENABLE_LLM !== '1', 'SQL console is only built with VITE_ENABLE_LLM=1');

test.describe('SQL console', () => {
  test('does not load the SQL engine until the panel is opened', async ({ page }) => {
    const wasmRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.wasm')) wasmRequests.push(request.url());
    });

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });

    const openButton = page.getByRole('button', { name: 'Open SQL Console' });
    await expect(openButton).toBeVisible();
    await expect(page.getByLabel('SQL Query')).not.toBeVisible();
    expect(wasmRequests).toEqual([]);

    await openButton.click();
    await expect(page.getByLabel('SQL Query')).toBeVisible({ timeout: 15000 });
    expect(wasmRequests).toHaveLength(1);

    await page.getByLabel('SQL Query').fill('SELECT COUNT(*) AS n FROM rosout -- count');
    await page.getByRole('button', { name: 'Run Query' }).click();
    await expect(page.getByText('Rows: 1')).toBeVisible();
  });
});
