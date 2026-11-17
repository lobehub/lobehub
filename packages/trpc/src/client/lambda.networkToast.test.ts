import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from './lambda';

/**
 * While the desktop app is offline, background polls (the message cursor read,
 * the server queue, quota reads) fail every few seconds. Each failure used to
 * fire the network-error toast again under the same id, which kept one toast
 * pinned in the bottom-right corner for the whole outage and brought it back
 * right after the user closed it. That corner is where an in-topic question
 * card puts its Submit button, so the user's clicks landed on the toast and the
 * answer was never sent — with no request and no new error.
 */

const remoteServerErrorToast = vi.fn();

vi.mock('@/const/version', () => ({ isDesktop: true }));
vi.mock('@/services/_auth', () => ({ createHeaderWithAuth: async () => ({}) }));
vi.mock('@/business/client/trpc-headers', () => ({ getBusinessTrpcHeaders: async () => ({}) }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@/components/Error/remoteServerErrorToast', () => ({
  remoteServerErrorToast: (...args: unknown[]) => remoteServerErrorToast(...args),
}));

const proxyNetworkFailure = (errorType: string) =>
  new Response(JSON.stringify({ body: { detail: 'net::ERR_INTERNET_DISCONNECTED' }, errorType }), {
    headers: { 'X-Proxy-Error': '1', 'content-type': 'application/json' },
    status: 502,
  });

const ok = () =>
  new Response(JSON.stringify([{ result: { data: { json: null } } }]), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });

const poll = () => lambdaClient.agent.getAgentConfigById.query({ agentId: 'agt_test' });

// the toast is raised from a dynamic import after the response is parsed
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lambdaClient desktop network-error toast', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost/chat'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    remoteServerErrorToast.mockReset();
  });

  afterEach(async () => {
    // end the outage so module state does not leak into the next case
    fetchMock.mockResolvedValue(ok());
    await poll();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('raises the toast once per outage instead of on every failed poll', async () => {
    fetchMock.mockImplementation(async () => proxyNetworkFailure('RemoteServerOffline'));

    for (let i = 0; i < 5; i++) {
      await expect(poll()).rejects.toBeDefined();
      await flush();
    }

    expect(remoteServerErrorToast).toHaveBeenCalledTimes(1);
    expect(remoteServerErrorToast).toHaveBeenCalledWith('RemoteServerOffline');
  });

  it('raises it again for a new outage after a request gets through', async () => {
    fetchMock.mockImplementation(async () => proxyNetworkFailure('RemoteServerOffline'));
    await expect(poll()).rejects.toBeDefined();
    await flush();

    fetchMock.mockImplementation(async () => ok());
    await poll();

    fetchMock.mockImplementation(async () => proxyNetworkFailure('RemoteServerOffline'));
    await expect(poll()).rejects.toBeDefined();
    await flush();

    expect(remoteServerErrorToast).toHaveBeenCalledTimes(2);
  });
});
