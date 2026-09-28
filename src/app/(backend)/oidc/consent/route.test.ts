/**
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const mocks = vi.hoisted(() => ({
  getInteractionDetails: vi.fn(),
  getInteractionResult: vi.fn(),
  getUserAuth: vi.fn(),
}));

vi.mock('debug', () => ({ default: () => vi.fn() }));

vi.mock('@lobechat/utils/server', () => ({ getUserAuth: mocks.getUserAuth }));

vi.mock('@/server/services/oidc', () => ({
  OIDCService: {
    initialize: vi.fn(async () => ({
      getInteractionDetails: mocks.getInteractionDetails,
      getInteractionResult: mocks.getInteractionResult,
    })),
  },
}));

const createRequest = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request('https://lobehub-cloud-next-stable.vercel.app/oidc/consent', {
    body,
    headers: { origin: 'https://lobehub.com' },
    method: 'POST',
  }) as unknown as NextRequest;
};

describe('POST /oidc/consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserAuth.mockResolvedValue({ userId: 'user-1' });
    mocks.getInteractionDetails.mockResolvedValue({
      params: { client_id: 'lobehub-desktop' },
      prompt: { details: {}, name: 'login' },
    });
    mocks.getInteractionResult.mockResolvedValue(
      'https://app.lobehub.com/oidc/auth/uid-1?resume=1',
    );
  });

  it('redirects back into the provider on the origin the browser is using', async () => {
    const response = await POST(createRequest({ consent: 'accept', uid: 'uid-1' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/oidc/auth/uid-1?resume=1');
    expect(mocks.getInteractionResult).toHaveBeenCalledWith('uid-1', {
      login: { accountId: 'user-1', remember: true },
    });
  });

  it('returns 400 when the interaction session is gone', async () => {
    mocks.getInteractionDetails.mockRejectedValue(new Error('interaction session not found'));

    const response = await POST(createRequest({ consent: 'accept', uid: 'uid-1' }));

    expect(response.status).toBe(400);
    expect(mocks.getInteractionResult).not.toHaveBeenCalled();
  });
});
