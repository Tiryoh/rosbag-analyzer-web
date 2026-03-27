import { test, expect } from '@playwright/test';
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');
const sqlPromise = initSqlJs({
  locateFile: () => path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
});

async function uploadBag(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

async function openDownloadedDatabase(download: import('@playwright/test').Download) {
  const targetPath = path.join(os.tmpdir(), download.suggestedFilename());
  await download.saveAs(targetPath);
  const SQL = await sqlPromise;
  const bytes = new Uint8Array(fs.readFileSync(targetPath));
  return new SQL.Database(bytes);
}

test.describe('SQLite export', () => {
  test.beforeEach(async ({ page }) => {
    await uploadBag(page);
  });

  test('exports filtered rosout rows to sqlite', async ({ page }) => {
    await page.getByRole('button', { name: 'ERROR' }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-rosout-sqlite').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^rosout_export_.*\.sqlite$/);

    const db = await openDownloadedDatabase(download);
    const rows = db.exec(`
      SELECT node, severity, message
      FROM rosout_logs
      ORDER BY id
    `);

    expect(rows[0].values).toEqual([
      ['/planner/global', 'ERROR', 'Failed to find valid path'],
      ['/sensor/lidar', 'ERROR', 'Connection timeout'],
    ]);
    db.close();
  });

  test('exports filtered diagnostics and child values to sqlite', async ({ page }) => {
    await page.getByTestId('diagnostics-tab').click();
    await page.getByRole('button', { name: 'WARN', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-diagnostics-sqlite').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^diagnostics_export_.*\.sqlite$/);

    const db = await openDownloadedDatabase(download);
    const diagnosticsRows = db.exec(`
      SELECT name, level_code, level_name, message
      FROM diagnostics
      ORDER BY id
    `);
    const valueRows = db.exec(`
      SELECT diagnostic_id, key, value
      FROM diagnostic_values
      ORDER BY diagnostic_id, id
    `);

    expect(diagnosticsRows[0].values).toEqual([
      ['/sensor/camera', 1, 'WARN', 'Low frame rate'],
      ['/motor/left', 1, 'WARN', 'High temperature'],
    ]);
    expect(valueRows[0].values).toEqual([
      [1, 'fps', '12'],
      [1, 'resolution', '1920x1080'],
      [2, 'temp_celsius', '75.2'],
      [2, 'current_amps', '4.8'],
    ]);
    db.close();
  });
});
