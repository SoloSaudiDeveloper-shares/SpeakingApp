import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { hashPassword } from '../../src/lib/utils/password';

const forcedUsername = `e2e-forced-${randomBytes(5).toString('hex')}`;
const disabledUsername = `e2e-disabled-${randomBytes(5).toString('hex')}`;
const forcedPassword = `${randomBytes(18).toString('base64url')}aA1!`;
const disabledPassword = `${randomBytes(18).toString('base64url')}bB2!`;

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(
      `INSERT INTO user_accounts
        (username, password_hash, role, display_name, is_active, must_change_password, created_at)
       VALUES ($1, $2, 'Admin', 'E2E forced change', true, true, now()),
              ($3, $4, 'Teacher', 'E2E disabled account', false, true, now())`,
      [forcedUsername, hashPassword(forcedPassword), disabledUsername, hashPassword(disabledPassword)],
    );
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(`DELETE FROM user_accounts WHERE username = ANY($1::text[])`, [
      [forcedUsername, disabledUsername],
    ]);
  } finally {
    await pool.end();
  }
});

async function submitLogin(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
) {
  await page.goto('/');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test('an account marked for password change cannot enter the application', async ({ page }) => {
  await submitLogin(page, forcedUsername, forcedPassword);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: /change password/i })).toBeVisible();
  const protectedResponse = await page.request.get('/api/admin/integrations/xapi/status');
  expect(protectedResponse.status()).toBe(401);
  const replacement = `${randomBytes(18).toString('base64url')}zZ9!`;
  await page.getByLabel(/^current password$/i).fill(forcedPassword);
  await page.getByLabel(/^new password$/i).fill(replacement);
  await page.getByLabel(/^confirm new password$/i).fill(replacement);
  await page.getByRole('button', { name: /change password/i }).click();
  await expect(page.getByText(/password changed successfully/i)).toBeVisible();
  const authorizedAfterChange = await page.request.get('/api/admin/integrations/xapi/status');
  expect(authorizedAfterChange.status()).toBe(200);
});

test('a disabled migrated account cannot sign in', async ({ page }) => {
  await submitLogin(page, disabledUsername, disabledPassword);
  await expect(page.getByText(/invalid username or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('Admin-created learners require a strong temporary password and a forced change', async ({ page }) => {
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  test.skip(!adminPassword, 'DEMO_ADMIN_PASSWORD is required.');
  await submitLogin(page, 'demo-admin', adminPassword!);
  await expect(page).toHaveURL(/\/admin\/students/);

  const uniqueNumber = `e2e-student-${randomBytes(5).toString('hex')}`;
  const weak = await page.request.post('/api/students', {
    data: { uniqueNumber, fullName: 'E2E learner', password: 'short' },
  });
  expect(weak.status()).toBe(400);

  const temporaryPassword = `${randomBytes(18).toString('base64url')}cC3!`;
  const created = await page.request.post('/api/students', {
    data: { uniqueNumber, fullName: 'E2E learner', password: temporaryPassword },
  });
  expect(created.status()).toBe(200);
  const studentId = (await created.json()).student.id as number;

  try {
    const loginResponse = await fetch(
      new URL('/api/auth/login', test.info().project.use.baseURL as string),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uniqueNumber, password: temporaryPassword }),
      },
    );
    expect(loginResponse.status).toBe(200);
    expect((await loginResponse.json()).user.mustChangePassword).toBe(true);
  } finally {
    const deleted = await page.request.delete(`/api/students/${studentId}`);
    expect(deleted.status()).toBe(200);
  }
});

test('provider secrets are admin-only and API responses never return their value', async ({ page }) => {
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;
  test.skip(!adminPassword, 'DEMO_ADMIN_PASSWORD is required.');
  await submitLogin(page, 'demo-admin', adminPassword!);
  await expect(page).toHaveURL(/\/admin\/students/);
  const secret = `e2e-provider-${randomBytes(18).toString('base64url')}`;
  const saved = await page.request.post('/api/settings', {
    data: { key: 'groq_api_key', value: secret },
  });
  expect(saved.status()).toBe(200);
  try {
    const response = await page.request.get('/api/settings');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(secret);
    expect(JSON.parse(body).groq_api_key).toBe('••••••••');
  } finally {
    const cleared = await page.request.post('/api/settings', {
      data: { key: 'groq_api_key', value: '' },
    });
    expect(cleared.status()).toBe(200);
  }
});

for (const fixture of [
  { role: 'Admin', username: 'demo-admin', passwordEnv: 'DEMO_ADMIN_PASSWORD', landing: /\/admin\/students/ },
  { role: 'Teacher', username: 'demo-teacher', passwordEnv: 'DEMO_TEACHER_PASSWORD', landing: /\/teacher/ },
] as const) {
  test(`${fixture.role} signs in and receives the correct authorization boundary`, async ({ page }) => {
    const password = process.env[fixture.passwordEnv];
    test.skip(!password, `${fixture.passwordEnv} is required.`);
    await submitLogin(page, fixture.username, password!);
    await expect(page).toHaveURL(fixture.landing);
    const adminResponse = await page.request.get('/api/admin/integrations/xapi/status');
    expect(adminResponse.status()).toBe(fixture.role === 'Admin' ? 200 : 403);
    if (fixture.role === 'Teacher') {
      const secretWrite = await page.request.post('/api/settings', {
        data: { key: 'groq_api_key', value: 'teacher-must-never-store-this' },
      });
      expect(secretWrite.status()).toBe(403);
      const settings = await page.request.get('/api/settings');
      expect((await settings.json()).groq_api_key).toBeUndefined();
    }
  });
}
