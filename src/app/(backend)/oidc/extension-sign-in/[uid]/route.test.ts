/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  authEnv: { ENABLE_OIDC: true },
  getInteractionDetails: vi.fn(),
  getInteractionResult: vi.fn(),
  getUserAuth: vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({ getUserAuth: mocks.getUserAuth }));
vi.mock('debug', () => ({ default: () => vi.fn() }));
vi.mock('@/envs/auth', () => ({ authEnv: mocks.authEnv }));
vi.mock('@/server/services/oidc', () => ({
  OIDCService: {
    initialize: vi.fn(async () => ({
      getInteractionDetails: mocks.getInteractionDetails,
      getInteractionResult: mocks.getInteractionResult,
    })),
  },
}));

const visit = (uid: string, search = '') =>
  GET(
    new Request(
      `https://example.com/oidc/extension-sign-in/${uid}${search}`,
    ) as unknown as NextRequest,
    { params: Promise.resolve({ uid }) },
  );

const loginFor = (clientId: string) => ({
  params: { client_id: clientId },
  prompt: { name: 'login' },
});

describe('GET /oidc/extension-sign-in/[uid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authEnv.ENABLE_OIDC = true;
    mocks.getInteractionDetails.mockResolvedValue(loginFor('lobehub-acceptance-extension'));
    mocks.getUserAuth.mockResolvedValue({ userId: 'user_1' });
    mocks.getInteractionResult.mockResolvedValue('http://internal-host/oidc/auth/uid-1?x=1');
  });

  it('returns 404 when OIDC is not enabled', async () => {
    mocks.authEnv.ENABLE_OIDC = false;

    expect((await visit('uid-1')).status).toBe(404);
    expect(mocks.getInteractionDetails).not.toHaveBeenCalled();
  });

  it('signs a reviewer with a web session in and resumes on the same origin', async () => {
    const response = await visit('uid-1');

    expect(mocks.getInteractionResult).toHaveBeenCalledWith('uid-1', {
      login: { accountId: 'user_1', remember: true },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/oidc/auth/uid-1?x=1');
  });

  it('hands a browser with no web session to the sign-in page, keeping its language', async () => {
    mocks.getUserAuth.mockResolvedValue({ userId: undefined });

    const response = await visit('uid-1', '?hl=zh-CN');

    expect(mocks.getInteractionResult).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/oauth/consent/uid-1?hl=zh-CN');
  });

  it('never signs in for another client or another prompt', async () => {
    mocks.getInteractionDetails.mockResolvedValue(loginFor('lobehub-desktop'));
    expect((await visit('uid-1')).headers.get('location')).toBe('/oauth/consent/uid-1');

    mocks.getInteractionDetails.mockResolvedValue({
      params: { client_id: 'lobehub-acceptance-extension' },
      prompt: { name: 'consent' },
    });
    expect((await visit('uid-1')).headers.get('location')).toBe('/oauth/consent/uid-1');
    expect(mocks.getInteractionResult).not.toHaveBeenCalled();
  });

  it('leaves an interaction it cannot read to the consent page', async () => {
    mocks.getInteractionDetails.mockRejectedValue(new Error('interaction session not found'));

    expect((await visit('uid-1')).headers.get('location')).toBe('/oauth/consent/uid-1');
  });
});
