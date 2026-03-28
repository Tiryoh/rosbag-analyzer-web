import { test, expect } from '@playwright/test';
import { parquetReadObjects } from 'hyparquet';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');

async function uploadBag(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

async function readDownloadedParquet(download: import('@playwright/test').Download): Promise<Record<string, unknown>[]> {
  const targetPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(targetPath);
  const nodeBuffer = fs.readFileSync(targetPath);
  const arrayBuffer = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
  return await parquetReadObjects({ file: arrayBuffer as ArrayBuffer }) as Record<string, unknown>[];
}

test.describe('Parquet export', () => {
  test.beforeEach(async ({ page }) => {
    await uploadBag(page);
  });

  test('exports filtered rosout rows to parquet', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-rosout-parquet').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^rosout_export_.*\.parquet$/);

    const rows = await readDownloadedParquet(download);

    expect(rows).toHaveLength(2);
    expect(rows.map(r => [r.node, r.severity, r.message])).toEqual([
      ['/planner/global', 'ERROR', 'Failed to find valid path'],
      ['/sensor/lidar', 'ERROR', 'Connection timeout'],
    ]);
  });

  test('exports filtered diagnostics to parquet', async ({ page }) => {
    await page.getByTestId('diagnostics-tab').click();
    await page.getByRole('button', { name: 'WARN', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-diagnostics-parquet').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^diagnostics_export_.*\.parquet$/);

    const rows = await readDownloadedParquet(download);

    expect(rows).toHaveLength(2);
    expect(rows.map(r => [r.name, r.level_code, r.level_name, r.message])).toEqual([
      ['/sensor/camera', 1, 'WARN', 'Low frame rate'],
      ['/motor/left', 1, 'WARN', 'High temperature'],
    ]);

    expect(rows[0].values_json).toEqual([
      { key: 'fps', value: '12' },
      { key: 'resolution', value: '1920x1080' },
    ]);
    expect(rows[1].values_json).toEqual([
      { key: 'temp_celsius', value: '75.2' },
      { key: 'current_amps', value: '4.8' },
    ]);
  });
});
