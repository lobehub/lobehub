/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  authEnv: { ENABLE_OIDC: true },
  getConsentClientMetadata: vi.fn(),
  getUserAuth: vi.fn(),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@lobechat/utils/server', () => ({
  getUserAuth: mocks.getUserAuth,
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mocks.authEnv,
}));

vi.mock('@/server/services/oidc', () => ({
  OIDCService: {
    initialize: vi.fn(async () => ({
      getConsentClientMetadata: mocks.getConsentClientMetadata,
    })),
  },
}));

const createRequest = (clientId: string) =>
  new Request(`https://example.com/oidc/client-metadata/${clientId}`) as unknown as NextRequest;

const createProps = (clientId: string) => ({ params: Promise.resolve({ clientId }) });

describe('GET /oidc/client-metadata/[clientId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authEnv.ENABLE_OIDC = true;
    mocks.getUserAuth.mockResolvedValue({ userId: 'user-1' });
  });

  it('returns 404 when OIDC is not enabled', async () => {
    mocks.authEnv.ENABLE_OIDC = false;

    const response = await GET(createRequest('lca_1'), createProps('lca_1'));

    expect(response.status).toBe(404);
    expect(mocks.getConsentClientMetadata).not.toHaveBeenCalled();
  });

  it('returns 401 for an anonymous request', async () => {
    mocks.getUserAuth.mockResolvedValue({ userId: undefined });

    const response = await GET(createRequest('lca_1'), createProps('lca_1'));

    expect(response.status).toBe(401);
    expect(mocks.getConsentClientMetadata).not.toHaveBeenCalled();
  });

  it('returns metadata for an authenticated request', async () => {
    mocks.getConsentClientMetadata.mockResolvedValue({
      clientName: 'Third Party App',
      developerName: 'Jane Doe',
      isFirstParty: false,
      policyUri: 'https://third.party/privacy',
    });

    const response = await GET(createRequest('lca_1'), createProps('lca_1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clientName: 'Third Party App',
      developerName: 'Jane Doe',
      isFirstParty: false,
      policyUri: 'https://third.party/privacy',
    });
    expect(mocks.getConsentClientMetadata).toHaveBeenCalledWith('lca_1');
  });

  it('returns 500 on unexpected errors', async () => {
    mocks.getConsentClientMetadata.mockRejectedValue(new Error('database exploded'));

    const response = await GET(createRequest('lca_1'), createProps('lca_1'));

    expect(response.status).toBe(500);
  });
});
