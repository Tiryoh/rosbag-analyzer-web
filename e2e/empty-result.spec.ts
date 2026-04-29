import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const fixtures = [
  {
    label: 'MCAP',
    file: 'test_sample_no_rosout.mcap',
    topic: '/sensor/lidar/points',
    type: 'sensor_msgs/msg/PointCloud2',
  },
  {
    label: 'ROS1 bag',
    file: 'test_sample_no_rosout.bag',
    topic: '/sensor/lidar/scan',
    type: 'sensor_msgs/LaserScan',
  },
];

for (const fixture of fixtures) {
  test.describe(`Loaded but no rosout/diagnostics messages (${fixture.label})`, () => {
    const fixturePath = path.resolve(__dirname, 'fixtures', fixture.file);

    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.locator('input[type="file"]').setInputFiles(fixturePath);
      await expect(page.getByTestId('empty-result-panel')).toBeVisible({ timeout: 15000 });
    });

    test('shows the loaded-but-empty notice with the file name', async ({ page }) => {
      const panel = page.getByTestId('empty-result-panel');
      await expect(panel).toContainText(fixture.file);
      await expect(panel).toContainText(/no rosout or diagnostics topics/i);
    });

    test('does not show the success status panel', async ({ page }) => {
      await expect(page.getByText(/Loaded \d+ rosout messages/)).not.toBeVisible();
    });

    test('does not surface an error', async ({ page }) => {
      await expect(page.getByTestId('error-panel')).not.toBeVisible();
    });

    test('lists the unrelated topics in the file', async ({ page }) => {
      const panel = page.getByTestId('empty-result-panel');
      await panel.locator('summary').click();
      const topicList = page.getByTestId('available-topics');
      await expect(topicList).toBeVisible();
      await expect(topicList).toContainText(fixture.topic);
      await expect(topicList).toContainText(fixture.type);
    });

    test('does not render filters or message tables', async ({ page }) => {
      await expect(page.getByText('Filters')).not.toBeVisible();
      await expect(page.locator('table')).not.toBeVisible();
    });
  });
}
