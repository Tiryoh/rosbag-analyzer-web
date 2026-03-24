import { defineConfig, devices } from '@playwright/test';

const isSingleFile = process.env.E2E_VARIANT === 'singlefile';
const outputDir = isSingleFile ? 'dist-singlefile' : 'dist';
const buildCommand = isSingleFile ? 'npm run build:singlefile' : 'npm run build';
const reportFolder = isSingleFile ? 'playwright-report-singlefile' : 'playwright-report';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never', outputFolder: reportFolder }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `${buildCommand} && python3 -m http.server 3000 --bind 127.0.0.1 --directory ${outputDir}`,
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
  },
});
