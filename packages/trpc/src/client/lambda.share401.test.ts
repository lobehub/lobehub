import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from './lambda';

/**
 * A shared topic page that renders a `role='verify'` message used to fire
 * `verify.getVerifyState` / `verify.listResults`. Those run on an authed
 * procedure, so an anonymous viewer got 401, and the global 401 handler then
 * sent the reader to /signin with reason=sessionExpired — or logged a signed-in
 * reader out. A public share page must never do either because of a side query
 * it cannot authorize.
 */

const openLogin = vi.fn<(reason?: string) => void>();
const logout = vi.fn();
const userState = { isSignedIn: false, logout, openLogin };

vi.mock('@/const/version', () => ({ isDesktop: false }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: async () => ({}) }));
vi.mock('@/business/client/trpc-headers', () => ({ getBusinessTrpcHeaders: async () => ({}) }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/store/user/store', () => ({ getUserStoreState: () => userState }));
vi.mock('@/components/Error/loginRequiredNotification', () => ({
  loginRequired: { redirect: ({ reason }: { reason?: string } = {}) => openLogin(reason) },
}));

const unauthorized = (path: string) =>
  new Response(
    JSON.stringify({
      error: {
        json: {
          code: -32_001,
          data: { code: 'UNAUTHORIZED', httpStatus: 401, path },
          message: 'UNAUTHORIZED',
        },
      },
    }),
    { headers: { 'content-type': 'application/json' }, status: 401 },
  );

describe('lambdaClient 401 handling on a public share page', () => {
  const fetchMock = vi.fn();
  let clock = 1_000_000_000_000;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/share/t/TFhGJfa4'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // step past the handler's 5s 401 debounce between cases
    clock += 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(clock);
    openLogin.mockReset();
    logout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('does not send an anonymous reader to /signin when verify.getVerifyState is 401', async () => {
    userState.isSignedIn = false;
    fetchMock.mockResolvedValue(unauthorized('verify.getVerifyState'));

    await expect(
      lambdaClient.verify.getVerifyState.query({ operationId: 'op_r1018' }),
    ).rejects.toBeDefined();
    // the handler awaits dynamic imports before redirecting
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openLogin).not.toHaveBeenCalled();
  });

  it('does not log a signed-in non-owner out when verify.listResults is 401', async () => {
    userState.isSignedIn = true;
    fetchMock.mockResolvedValue(unauthorized('verify.listResults'));

    await expect(
      lambdaClient.verify.listResults.query({ operationId: 'op_r1018' }),
    ).rejects.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logout).not.toHaveBeenCalled();
  });
});

describe('lambdaClient 401 handling outside share pages', () => {
  const fetchMock = vi.fn();
  let clock = 2_000_000_000_000;

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/agent/agt_1'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clock += 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(clock);
    openLogin.mockReset();
    logout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('asks a reader without a session to sign in, without the session-expired notice', async () => {
    userState.isSignedIn = false;
    fetchMock.mockResolvedValue(unauthorized('verify.getVerifyState'));

    await expect(
      lambdaClient.verify.getVerifyState.query({ operationId: 'op_1' }),
    ).rejects.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openLogin).toHaveBeenCalledTimes(1);
    expect(openLogin).toHaveBeenCalledWith(undefined);
  });

  it('still logs a signed-in user out with reason=sessionExpired', async () => {
    userState.isSignedIn = true;
    fetchMock.mockResolvedValue(unauthorized('verify.listResults'));

    await expect(
      lambdaClient.verify.listResults.query({ operationId: 'op_1' }),
    ).rejects.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logout).toHaveBeenCalledTimes(1);
    const { redirectTo } = logout.mock.calls[0][0] as { redirectTo: string };
    const params = new URL(redirectTo, 'http://localhost').searchParams;
    expect(params.get('reason')).toBe('sessionExpired');
    expect(params.get('callbackUrl')).toBe('http://localhost/agent/agt_1');
  });
});
