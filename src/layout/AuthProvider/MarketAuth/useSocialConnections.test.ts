import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSocialConnections } from './useSocialConnections';

const connectGetStatusQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      socialProfile: {
        scanClaimableResources: { query: vi.fn() },
      },
    },
  },
  toolsClient: {
    market: {
      connectGetAuthorizeUrl: { query: vi.fn() },
      connectGetStatus: { query: connectGetStatusQueryMock },
      connectRevoke: { mutate: vi.fn() },
    },
  },
}));

// Resolve on a macrotask, like a network response, so a refetch loop yields to timers
const respond = <T>(value: T) =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), 0);
  });

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

describe('useSocialConnections', () => {
  beforeEach(() => {
    connectGetStatusQueryMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should settle with connect controls available when both providers are disconnected', async () => {
    connectGetStatusQueryMock.mockImplementation(() => respond({ connected: false }));

    const { result, rerender } = renderHook((props) => useSocialConnections(props), {
      initialProps: { enabled: true, onClaimableResourcesFound: () => {} },
    });

    await settle();

    expect(result.current.isLoadingProfiles).toBe(false);
    expect(result.current.github.isConnected).toBe(false);
    expect(result.current.twitter.isConnected).toBe(false);
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(2);

    // An unrelated parent rerender must not start another status lookup
    rerender({ enabled: true, onClaimableResourcesFound: () => {} });
    await settle();

    expect(result.current.isLoadingProfiles).toBe(false);
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(2);
  });

  it('should fetch each provider once when both providers are connected', async () => {
    connectGetStatusQueryMock.mockImplementation(({ provider }) =>
      respond({ connected: true, connection: { providerUsername: `${provider}-user` } }),
    );

    const { result } = renderHook(() =>
      useSocialConnections({ enabled: true, onClaimableResourcesFound: () => {} }),
    );

    await settle();

    expect(result.current.isLoadingProfiles).toBe(false);
    expect(result.current.github.profile?.username).toBe('github-user');
    expect(result.current.twitter.profile?.username).toBe('twitter-user');
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(2);
  });

  it('should fetch again when re-enabled, and not while disabled', async () => {
    connectGetStatusQueryMock.mockImplementation(() => respond({ connected: false }));

    const { rerender } = renderHook((props) => useSocialConnections(props), {
      initialProps: { enabled: false },
    });

    await settle();
    expect(connectGetStatusQueryMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await settle();
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(2);

    rerender({ enabled: false });
    rerender({ enabled: true });
    await settle();
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(4);
  });
});
