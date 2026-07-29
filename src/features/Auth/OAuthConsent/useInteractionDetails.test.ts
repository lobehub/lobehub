import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OidcInteractionDetailsResponse } from '@/types/oidc';

import { fetchInteractionDetails, InteractionDetailsError } from './useInteractionDetails';

const mockFetchResponse = (status: number, body?: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    }) as unknown as Response,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchInteractionDetails', () => {
  it('returns interaction details on success', async () => {
    const details: OidcInteractionDetailsResponse = {
      clientId: 'lobehub-desktop',
      clientMetadata: { clientName: 'LobeHub Desktop', isFirstParty: true },
      prompt: 'consent',
      redirectUri: 'https://example.com/callback',
      scopes: ['openid', 'profile'],
      uid: 'abc',
    };
    const fetchSpy = mockFetchResponse(200, details);

    await expect(fetchInteractionDetails('abc')).resolves.toEqual(details);
    expect(fetchSpy).toHaveBeenCalledWith('/oidc/interaction/abc');
  });

  it('throws 409 error with promptName for unsupported interactions', async () => {
    mockFetchResponse(409, { error: 'unsupported_interaction', promptName: 'select_account' });

    const error = await fetchInteractionDetails('abc').catch((e) => e);

    expect(error).toBeInstanceOf(InteractionDetailsError);
    expect(error.status).toBe(409);
    expect(error.promptName).toBe('select_account');
  });

  it('throws 400 error for invalid sessions', async () => {
    mockFetchResponse(400, { error: 'session_invalid' });

    const error = await fetchInteractionDetails('abc').catch((e) => e);

    expect(error).toBeInstanceOf(InteractionDetailsError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('session_invalid');
  });

  it('throws 404 error when OIDC is disabled', async () => {
    mockFetchResponse(404);

    const error = await fetchInteractionDetails('abc').catch((e) => e);

    expect(error).toBeInstanceOf(InteractionDetailsError);
    expect(error.status).toBe(404);
  });

  it('throws 500 error with fallback message when body is not json', async () => {
    mockFetchResponse(500);

    const error = await fetchInteractionDetails('abc').catch((e) => e);

    expect(error).toBeInstanceOf(InteractionDetailsError);
    expect(error.status).toBe(500);
    expect(error.message).toBe('Request failed with status 500');
  });
});
