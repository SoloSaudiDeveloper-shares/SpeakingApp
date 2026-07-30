import { expect, test } from '@playwright/test';

async function signInLearner(page: import('@playwright/test').Page) {
  const password = process.env.DEMO_STUDENT_PASSWORD;
  test.skip(!password, 'DEMO_STUDENT_PASSWORD is required.');
  await page.addInitScript(() => {
    window.sessionStorage.setItem('speaking-lab-diagnostic-skip-session', '1');
  });
  await page.goto('/');
  await page.getByLabel(/username/i).fill('demo-learner');
  await page.getByLabel(/^password/i).fill(password!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|practice\/hub|onboarding\/diagnostic)/);
  await page.goto('/practice/hub');
}

test('learner sees actionable practice navigation', async ({ page }) => {
  await signInLearner(page);
  await expect(page.getByRole('tab', { name: /practice/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /continue lesson/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /weak words focus/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /free ai conversation/i })).toBeVisible();
  const settings = await page.request.get('/api/settings');
  expect((await settings.json()).groq_api_key).toBeUndefined();
  const secretWrite = await page.request.post('/api/settings', {
    data: { key: 'groq_api_key', value: 'student-must-never-store-this' },
  });
  expect(secretWrite.status()).toBe(403);
});

test('tab and collapsed-card preferences persist and reset', async ({ page }) => {
  await signInLearner(page);
  const preferencesSaved = page.waitForResponse((response) =>
    response.url().includes('/api/practice/dashboard-preferences') &&
    response.request().method() === 'PUT' &&
    response.ok(),
  );
  await page.getByRole('button', { name: 'Continue lesson' }).click();
  await preferencesSaved;
  await expect(page.getByRole('button', { name: 'Continue lesson' })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue lesson' })).toHaveAttribute('aria-expanded', 'false');

  const tabSaved = page.waitForResponse((response) =>
    response.url().includes('/api/practice/dashboard-preferences') &&
    response.request().method() === 'PUT' &&
    response.ok(),
  );
  await page.getByRole('tab', { name: /progress/i }).click();
  await tabSaved;
  await expect(page.getByText(/reflects what you have done/i)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: /progress/i })).toHaveAttribute('aria-selected', 'true');

  const resetSaved = page.waitForResponse((response) =>
    response.url().includes('/api/practice/dashboard-preferences') &&
    response.request().method() === 'PUT' &&
    response.ok(),
  );
  await page.getByRole('button', { name: /reset view/i }).click();
  await resetSaved;
  await expect(page.getByRole('tab', { name: /practice/i })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Continue lesson' })).toHaveAttribute('aria-expanded', 'true');
});
