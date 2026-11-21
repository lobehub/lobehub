import { describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.example.com' } }));

describe('connector client metadata document', () => {
  it('serves a cacheable document whose client_id is its own URL', async () => {
    const res = GET();

    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    await expect(res.json()).resolves.toMatchObject({
      client_id: 'https://app.example.com/oauth/connector/client-metadata.json',
      redirect_uris: ['https://app.example.com/oauth/connector/callback'],
      token_endpoint_auth_method: 'none',
    });
  });
});
