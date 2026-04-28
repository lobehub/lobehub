import { describe, expect, it } from 'vitest';

import { createMarketApp } from './app';

describe('createMarketApp', () => {
  it('returns the internal Market health payload', async () => {
    const app = createMarketApp();

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'lobehub-internal-market',
      status: 'ok',
    });
  });

  it('returns not implemented for scaffolded Market endpoints', async () => {
    const app = createMarketApp();

    const response = await app.request('/lobehub-oidc/auth');

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: {
        code: 'not_implemented',
        message: '/lobehub-oidc/auth is not implemented in the internal Market v1 service.',
      },
    });
  });

  it('returns a JSON error for unknown Market endpoints', async () => {
    const app = createMarketApp();

    const response = await app.request('/unknown');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'not_found',
        message: 'Requested Market endpoint was not found.',
      },
    });
  });
});
