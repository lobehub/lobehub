/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  appEnv: { APP_URL: 'https://app.example.com' },
  create: vi.fn(),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after: vi.fn() };
});

vi.mock('@/database/models/oauthHandoff', () => ({
  OAuthHandoffModel: class {
    create = mocks.create;
  },
}));

vi.mock('@/database/server', () => ({
  serverDB: {},
}));

vi.mock('@/envs/app', () => ({
  appEnv: mocks.appEnv,
}));

describe('GET /oidc/callback/desktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnv.APP_URL = 'https://app.example.com';
  });

  it('redirects internal failures without exposing the error message', async () => {
    const sensitiveError = 'database password leaked in callback';
    mocks.create.mockRejectedValueOnce(new Error(sensitiveError));
    const request = new NextRequest(
      'https://request.example.com/oidc/callback/desktop?code=auth-code&state=handoff-id',
    );

    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    const redirect = new URL(location!);
    expect(redirect.origin).toBe('https://app.example.com');
    expect(redirect.pathname).toBe('/oauth/callback/error');
    expect(redirect.searchParams.get('reason')).toBe('internal_error');
    expect(redirect.searchParams.has('errorMessage')).toBe(false);
    expect(location).not.toContain(sensitiveError);
  });
});
