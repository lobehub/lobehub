// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as marketAgentGet } from '@/app/(backend)/market/agent/[[...segments]]/route';
import { GET as marketOIDCGet } from '@/app/(backend)/market/oidc/[[...segments]]/route';
import { GET as marketSocialGet } from '@/app/(backend)/market/social/[[...segments]]/route';
import { GET as marketUserProfileGet } from '@/app/(backend)/market/user/[username]/route';
import { PUT as marketUserMePut } from '@/app/(backend)/market/user/me/route';
import honoApp from '@/server/hono';

const { createFromRequestMock, getUserInfoMock, updateUserInfoMock } = vi.hoisted(() => ({
  createFromRequestMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  updateUserInfoMock: vi.fn(),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: {
    createFromRequest: createFromRequestMock,
  },
}));

const createProfileRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/market/user/missing%20user', { headers });

const createAgentRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/market/agent', { headers });

const createOIDCRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/market/oidc', { headers });

const createSocialRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/market/social/missing-action', { headers });

const createUserMeRequest = (headers?: HeadersInit) =>
  new Request('https://example.com/market/user/me', {
    body: 'null',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'PUT',
  });

const createProfileSegmentData = () => ({
  params: Promise.resolve({ username: 'missing%20user' }),
});
const createAgentSegmentData = () => ({ params: Promise.resolve({ segments: [] }) });
const createOIDCSegmentData = () => ({ params: Promise.resolve({ segments: [] }) });
const createSocialSegmentData = () => ({
  params: Promise.resolve({ segments: ['missing-action'] }),
});

const expectMissingUser = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'user_not_found',
    message: 'User not found: missing user',
    status: 'error',
  });
};

const expectInvalidUserMePayload = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(400);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'invalid_payload',
    message: 'Request body must be a JSON object',
    status: 'error',
  });
};

const expectMissingAgentAction = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'not_found',
    message: 'Missing agent action.',
    status: 'error',
  });
};

const expectMissingOIDCEndpoint = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'missing_endpoint',
    message: 'Requested endpoint is not available.',
    status: 'error',
  });
};

const expectUnknownSocialAction = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(404);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.json()).toEqual({
    error: 'not_found',
    message: 'Unknown action: missing-action',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  createFromRequestMock.mockResolvedValue({
    market: {
      favorites: {},
      follows: {},
      likes: {},
      user: {
        getUserInfo: getUserInfoMock,
        updateUserInfo: updateUserInfoMock,
      },
    },
  });
  getUserInfoMock.mockResolvedValue({ user: null });
});

describe('/market/user/:username runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await marketUserProfileGet(createProfileRequest(), createProfileSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingUser(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await marketUserProfileGet(
      createProfileRequest({ 'x-lobe-api-runtime': 'hono' }),
      createProfileSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingUser(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createProfileRequest());

    await expectMissingUser(response);
  });
});

describe('/market/agent runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await marketAgentGet(createAgentRequest(), createAgentSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingAgentAction(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await marketAgentGet(
      createAgentRequest({ 'x-lobe-api-runtime': 'hono' }),
      createAgentSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingAgentAction(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createAgentRequest());

    await expectMissingAgentAction(response);
  });
});

describe('/market/social runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await marketSocialGet(createSocialRequest(), createSocialSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectUnknownSocialAction(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await marketSocialGet(
      createSocialRequest({ 'x-lobe-api-runtime': 'hono' }),
      createSocialSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectUnknownSocialAction(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createSocialRequest());

    await expectUnknownSocialAction(response);
  });
});

describe('/market/oidc runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await marketOIDCGet(createOIDCRequest(), createOIDCSegmentData());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectMissingOIDCEndpoint(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await marketOIDCGet(
      createOIDCRequest({ 'x-lobe-api-runtime': 'hono' }),
      createOIDCSegmentData(),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectMissingOIDCEndpoint(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createOIDCRequest());

    await expectMissingOIDCEndpoint(response);
  });
});

describe('/market/user/me runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await marketUserMePut(createUserMeRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectInvalidUserMePayload(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await marketUserMePut(createUserMeRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectInvalidUserMePayload(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createUserMeRequest());

    await expectInvalidUserMePayload(response);
  });
});
