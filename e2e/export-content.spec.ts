import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/test_sample.bag');

async function uploadBag(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
  await expect(page.getByText(/Loaded.*rosout messages/)).toBeVisible({ timeout: 15000 });
}

async function readDownloadedText(download: import('@playwright/test').Download): Promise<string> {
  const filePath = await download.path();
  return fs.readFileSync(filePath!, 'utf-8');
}

async function readDownloadedBuffer(download: import('@playwright/test').Download): Promise<Buffer> {
  const filePath = await download.path();
  return fs.readFileSync(filePath!);
}

// --- Rosout export content ---
test.describe('Rosout export content', () => {
  test.beforeEach(async ({ page }) => {
    await uploadBag(page);
  });

  test('CSV has BOM and correct structure', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);

    const buffer = await readDownloadedBuffer(download);
    expect(buffer[0]).toBe(0xEF);
    expect(buffer[1]).toBe(0xBB);
    expect(buffer[2]).toBe(0xBF);

    const content = await readDownloadedText(download);
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('Timestamp,Time,Node,Severity,Message,File,Line,Function,Topics');
    expect(lines).toHaveLength(11); // 1 header + 10 data rows
  });

  test('JSON is valid with expected fields', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);

    const content = await readDownloadedText(download);
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(10);
    expect(parsed[0]).toHaveProperty('timestamp');
    expect(parsed[0]).toHaveProperty('node');
    expect(parsed[0]).toHaveProperty('severity');
    expect(parsed[0]).toHaveProperty('message');
  });

  test('TXT has correct format', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);

    const content = await readDownloadedText(download);
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(10);
    for (const line of lines) {
      expect(line).toMatch(/^\[.+\] \[(DEBUG|INFO|WARN|ERROR|FATAL)\] \[.+\]: .+/);
    }
  });
});

// --- Diagnostics export content ---
test.describe('Diagnostics export content', () => {
  test.beforeEach(async ({ page }) => {
    await uploadBag(page);
    await page.getByRole('button', { name: /Diagnostics/ }).click();
  });

  test('CSV has BOM and correct structure', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'CSV' }).click(),
    ]);

    const buffer = await readDownloadedBuffer(download);
    expect(buffer[0]).toBe(0xEF);
    expect(buffer[1]).toBe(0xBB);
    expect(buffer[2]).toBe(0xBF);

    const content = await readDownloadedText(download);
    const lines = content.trim().split('\n');
    expect(lines[0]).toBe('Timestamp,Time,Name,Level,Message,Values');
    expect(lines.length).toBeGreaterThan(1);
  });

  test('JSON is valid with expected fields', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'JSON' }).click(),
    ]);

    const content = await readDownloadedText(download);
    const parsed = JSON.parse(content);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('name');
    expect(parsed[0]).toHaveProperty('level');
    expect(parsed[0]).toHaveProperty('message');
  });

  test('TXT has correct format', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'TXT' }).click(),
    ]);

    const content = await readDownloadedText(download);
    const lines = content.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^\[.+\] \[(OK|WARN|ERROR|STALE)\] .+: .+/);
    }
  });
});
