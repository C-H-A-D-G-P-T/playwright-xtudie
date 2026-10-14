import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 3,
	workers: 1,
	timeout: 60 * 60 * 1000,
	reporter: [['html', { open: 'never' }]],
	expect: {
		timeout: 60 * 1000,
	},
	use: {
		baseURL: 'https://xstudi.western.ac.th/',
		actionTimeout: 60 * 1000,
		navigationTimeout: 60 * 1000,

		trace: 'on',
	},
	projects: [
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
		},
	],
});
