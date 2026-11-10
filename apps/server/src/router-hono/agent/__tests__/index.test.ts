// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import app from '../index';

const { mockGatewayStart } = vi.hoisted(() => ({
  mockGatewayStart: vi.fn((c: { json: (body: object) => Response }) =>
    c.json({ status: 'started' }),
  ),
}));

vi.mock('../handlers/gatewayStart', () => ({ gatewayStart: mockGatewayStart }));

describe('agent gateway start authentication', () => {
  const originalActiveSecret = process.env.KEY_VAULTS_SECRET;
  const originalFallbackSecret = process.env.KEY_VAULTS_FALLBACK_SECRET;

  afterEach(() => {
    if (originalActiveSecret === undefined) delete process.env.KEY_VAULTS_SECRET;
    else process.env.KEY_VAULTS_SECRET = originalActiveSecret;

    if (originalFallbackSecret === undefined) delete process.env.KEY_VAULTS_FALLBACK_SECRET;
    else process.env.KEY_VAULTS_FALLBACK_SECRET = originalFallbackSecret;

    mockGatewayStart.mockClear();
  });

  it('rejects a fallback bearer token when the active secret is missing', async () => {
    delete process.env.KEY_VAULTS_SECRET;
    process.env.KEY_VAULTS_FALLBACK_SECRET = 'fallback-secret';

    const response = await app.request('/api/agent/gateway/start', {
      headers: { authorization: 'Bearer fallback-secret' },
      method: 'POST',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Service not configured' });
    expect(mockGatewayStart).not.toHaveBeenCalled();
  });

  it('rejects a fallback bearer token when the active secret is blank', async () => {
    process.env.KEY_VAULTS_SECRET = '   ';
    process.env.KEY_VAULTS_FALLBACK_SECRET = 'fallback-secret';

    const response = await app.request('/api/agent/gateway/start', {
      headers: { authorization: 'Bearer fallback-secret' },
      method: 'POST',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Service not configured' });
    expect(mockGatewayStart).not.toHaveBeenCalled();
  });
});
