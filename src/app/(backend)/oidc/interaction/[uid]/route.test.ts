/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const mocks = vi.hoisted(() => ({
  authEnv: { ENABLE_OIDC: true },
  getClientMetadata: vi.fn(),
  getInteractionDetails: vi.fn(),
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/envs/auth', () => ({
  authEnv: mocks.authEnv,
}));

vi.mock('@/libs/oidc-provider/config', () => ({
  defaultClients: [{ client_id: 'lobehub-desktop' }],
}));

vi.mock('@/server/services/oidc', () => ({
  OIDCService: {
    initialize: vi.fn(async () => ({
      getClientMetadata: mocks.getClientMetadata,
      getInteractionDetails: mocks.getInteractionDetails,
    })),
  },
}));

const createRequest = (uid: string) =>
  new Request(`https://example.com/oidc/interaction/${uid}`) as unknown as NextRequest;

const createProps = (uid: string) => ({ params: Promise.resolve({ uid }) });

describe('GET /oidc/interaction/[uid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authEnv.ENABLE_OIDC = true;
  });

  it('returns 404 when OIDC is not enabled', async () => {
    mocks.authEnv.ENABLE_OIDC = false;

    const response = await GET(createRequest('uid-1'), createProps('uid-1'));

    expect(response.status).toBe(404);
    expect(mocks.getInteractionDetails).not.toHaveBeenCalled();
  });

  it('returns interaction details for a consent prompt with a first-party client', async () => {
    mocks.getInteractionDetails.mockResolvedValue({
      params: {
        client_id: 'lobehub-desktop',
        redirect_uri: 'https://example.com/callback',
        scope: 'openid profile email',
      },
      prompt: { name: 'consent' },
    });
    mocks.getClientMetadata.mockResolvedValue({
      client_name: 'LobeHub Desktop',
      logo_uri: 'https://example.com/logo.png',
    });

    const response = await GET(createRequest('uid-1'), createProps('uid-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      clientId: 'lobehub-desktop',
      clientMetadata: {
        clientName: 'LobeHub Desktop',
        isFirstParty: true,
        logo: 'https://example.com/logo.png',
      },
      prompt: 'consent',
      redirectUri: 'https://example.com/callback',
      scopes: ['openid', 'profile', 'email'],
      uid: 'uid-1',
    });
    expect(mocks.getInteractionDetails).toHaveBeenCalledWith('uid-1');
    expect(mocks.getClientMetadata).toHaveBeenCalledWith('lobehub-desktop');
  });

  it('marks third-party clients as not first party', async () => {
    mocks.getInteractionDetails.mockResolvedValue({
      params: {
        client_id: 'third-party-app',
        redirect_uri: 'https://third.party/cb',
        scope: 'openid',
      },
      prompt: { name: 'consent' },
    });
    mocks.getClientMetadata.mockResolvedValue(undefined);

    const response = await GET(createRequest('uid-2'), createProps('uid-2'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.clientMetadata).toEqual({ isFirstParty: false });
    expect(body.clientId).toBe('third-party-app');
  });

  it('returns interaction details for a login prompt', async () => {
    mocks.getInteractionDetails.mockResolvedValue({
      params: { client_id: 'lobehub-desktop' },
      prompt: { name: 'login' },
    });
    mocks.getClientMetadata.mockResolvedValue({ client_name: 'LobeHub Desktop' });

    const response = await GET(createRequest('uid-3'), createProps('uid-3'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.prompt).toBe('login');
    expect(body.scopes).toEqual([]);
    expect(body.uid).toBe('uid-3');
  });

  it('returns 409 for unsupported interaction prompts', async () => {
    mocks.getInteractionDetails.mockResolvedValue({
      params: {},
      prompt: { name: 'select_account' },
    });

    const response = await GET(createRequest('uid-4'), createProps('uid-4'));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'unsupported_interaction',
      promptName: 'select_account',
    });
  });

  it('returns 400 when the interaction session is not found', async () => {
    mocks.getInteractionDetails.mockRejectedValue(new Error('interaction session not found'));

    const response = await GET(createRequest('uid-5'), createProps('uid-5'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'session_invalid' });
  });

  it('returns 500 on unexpected errors', async () => {
    mocks.getInteractionDetails.mockRejectedValue(new Error('database exploded'));

    const response = await GET(createRequest('uid-6'), createProps('uid-6'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'server_error' });
  });
});
