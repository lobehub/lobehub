import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { TEST_USER } from '../../support/seedTestUser';
import type { CustomWorld } from '../../support/world';

const CLIENT_ID = 'lobehub-cli';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const RESOURCE = 'urn:lobehub:chat';
const SCOPES = 'openid profile email offline_access';

interface DeviceAuthorizationResponse {
  device_code: string;
  expires_in: number;
  interval?: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  refresh_token?: string;
  token_type?: string;
}

interface AccessTokenClaims {
  aud?: string | string[];
  iss?: string;
  sub?: string;
}

const getDeviceAuthorization = (world: CustomWorld): DeviceAuthorizationResponse => {
  const deviceAuthorization = world.testContext
    .oidcDeviceAuthorization as DeviceAuthorizationResponse;

  if (!deviceAuthorization) throw new Error('OIDC device authorization has not been created');

  return deviceAuthorization;
};

/**
 * Remove reusable authorization state so every run must traverse both native form submissions.
 */
const resetOidcAuthorizationState = async (): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the OIDC E2E scenario');

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM oidc_access_tokens WHERE user_id = $1 AND client_id = $2', [
      TEST_USER.id,
      CLIENT_ID,
    ]);
    await client.query('DELETE FROM oidc_refresh_tokens WHERE user_id = $1 AND client_id = $2', [
      TEST_USER.id,
      CLIENT_ID,
    ]);
    await client.query('DELETE FROM oidc_device_codes WHERE user_id = $1 AND client_id = $2', [
      TEST_USER.id,
      CLIENT_ID,
    ]);
    await client.query('DELETE FROM oidc_grants WHERE user_id = $1 AND client_id = $2', [
      TEST_USER.id,
      CLIENT_ID,
    ]);
    await client.query('DELETE FROM oidc_sessions WHERE user_id = $1', [TEST_USER.id]);
    await client.query('DELETE FROM oidc_consents WHERE user_id = $1 AND client_id = $2', [
      TEST_USER.id,
      CLIENT_ID,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};

const decodeAccessToken = (accessToken: string): AccessTokenClaims => {
  const payload = accessToken.split('.')[1];
  if (!payload) throw new Error('OIDC access token is not a JWT');

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenClaims;
};

Given('CLI 已发起 OIDC Device Flow', async function (this: CustomWorld) {
  await resetOidcAuthorizationState();

  const response = await this.browserContext.request.post('/oidc/device/auth', {
    form: {
      client_id: CLIENT_ID,
      resource: RESOURCE,
      scope: SCOPES,
    },
  });
  const responseBody = await response.text();

  expect(
    response.ok(),
    `Device authorization failed with ${response.status()}: ${responseBody}`,
  ).toBe(true);

  const deviceAuthorization = JSON.parse(responseBody) as DeviceAuthorizationResponse;
  expect(deviceAuthorization.device_code).toBeTruthy();
  expect(deviceAuthorization.user_code).toMatch(/^\w{4}-\w{4}$/);
  expect(deviceAuthorization.verification_uri).toBeTruthy();

  this.testContext.oidcDeviceAuthorization = deviceAuthorization;
  this.testContext.oidcVerificationUrl =
    deviceAuthorization.verification_uri_complete ||
    `${deviceAuthorization.verification_uri}?user_code=${encodeURIComponent(deviceAuthorization.user_code)}`;
});

When('用户打开设备授权链接', async function (this: CustomWorld) {
  const verificationUrl = this.testContext.oidcVerificationUrl as string | undefined;
  if (!verificationUrl) throw new Error('OIDC verification URL is unavailable');

  await this.page.goto(verificationUrl, { waitUntil: 'domcontentloaded' });
  await expect(this.page).toHaveURL(/\/oauth\/device\/confirm(?:\?|$)/);
});

Then('页面应显示待授权的设备码', async function (this: CustomWorld) {
  const { user_code: userCode } = getDeviceAuthorization(this);

  await expect(this.page.getByText(userCode, { exact: true })).toBeVisible();
  await expect(
    this.page.locator('form[action="/oidc/device"] button[type="submit"]:not([name="abort"])'),
  ).toBeEnabled();
});

When('用户授权该设备', async function (this: CustomWorld) {
  const authorizeButton = this.page.locator(
    'form[action="/oidc/device"] button[type="submit"]:not([name="abort"])',
  );

  await expect(authorizeButton).toBeVisible();
  await authorizeButton.click();
  await expect(this.page).toHaveURL(/\/oauth\/consent\/[^/?]+/);
});

Then('应进入 OIDC 授权交互', async function (this: CustomWorld) {
  const consentForm = this.page.locator('form[action="/oidc/consent"]');

  await expect(consentForm.getByTestId('oauth-consent-accept')).toBeVisible();
  await expect(consentForm.locator('input[name="consent"]')).toHaveValue('accept');
});

When('用户同意 CLI 的权限请求', async function (this: CustomWorld) {
  const consentForm = this.page.locator('form[action="/oidc/consent"]');
  const consentInput = consentForm.locator('input[name="consent"]');
  const acceptButton = consentForm.getByTestId('oauth-consent-accept');
  const denyButton = consentForm.getByTestId('oauth-consent-deny');

  // Some provider sessions require an account confirmation before the consent prompt.
  // Advance that interaction when present, then require the explicit allow/deny prompt.
  if (!(await denyButton.isVisible())) {
    await expect(consentInput).toHaveValue('accept');
    await acceptButton.click();
    await expect(denyButton).toBeVisible();
  }

  await expect(consentInput).toHaveValue('accept');
  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
  await expect(this.page).toHaveURL(/\/oauth\/device\/success(?:\?|$)/);
});

Then('应显示设备授权成功页面', async function (this: CustomWorld) {
  await expect(this.page).toHaveURL(/\/oauth\/device\/success(?:\?|$)/);
  await expect(this.page.getByText(/Authorization Successful|授权成功/i)).toBeVisible();
});

Then('CLI 应取得 access token 与 refresh token', async function (this: CustomWorld) {
  const { device_code: deviceCode } = getDeviceAuthorization(this);
  const response = await this.browserContext.request.post('/oidc/token', {
    form: {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: DEVICE_CODE_GRANT,
    },
  });
  const responseBody = await response.text();

  expect(response.ok(), `Token polling failed with ${response.status()}: ${responseBody}`).toBe(
    true,
  );

  const token = JSON.parse(responseBody) as TokenResponse;
  expect(token.error, token.error_description).toBeUndefined();
  expect(token.token_type).toBe('Bearer');
  expect(token.access_token).toBeTruthy();
  expect(token.refresh_token).toBeTruthy();

  const claims = decodeAccessToken(token.access_token!);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  expect(audiences).toContain(RESOURCE);
  expect(claims.iss).toBe(`${new URL(this.page.url()).origin}/oidc`);
  expect(claims.sub).toBe(TEST_USER.id);
});
