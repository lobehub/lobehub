import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const createRequest = () =>
  new NextRequest('https://app.example.com/api/composio/oauth/callback?status=success');

afterEach(() => vi.unstubAllEnvs());

describe('Composio OAuth callback frame protections', () => {
  it('adds default frame protections in the standalone image', async () => {
    vi.stubEnv('DOCKER', 'true');
    vi.stubEnv('ENABLED_CSP', undefined);

    const response = await GET(createRequest());

    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none';");
  });

  it('honors the runtime opt-out for the matcher-skipped HTML route', async () => {
    vi.stubEnv('DOCKER', 'true');
    vi.stubEnv('ENABLED_CSP', '0');

    const response = await GET(createRequest());

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(response.headers.get('Content-Security-Policy')).toBeNull();
  });
});
