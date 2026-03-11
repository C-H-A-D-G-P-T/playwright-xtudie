import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	timeout: 10 * 60 * 1000,
	reporter: 'html',
	expect: {
		timeout: 60 * 1000,
	},
	use: {
		baseURL: 'https://xstudi.western.ac.th/',
		actionTimeout: 60 * 1000,
		navigationTimeout: 60 * 1000,

		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
