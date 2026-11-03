import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSocialConnect } from './useSocialConnect';

const connectGetStatusQueryMock = vi.hoisted(() => vi.fn());
const connectGetAuthorizeUrlQueryMock = vi.hoisted(() => vi.fn());
const connectRevokeMutateMock = vi.hoisted(() => vi.fn());
const scanClaimableResourcesQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      socialProfile: {
        scanClaimableResources: { query: scanClaimableResourcesQueryMock },
      },
    },
  },
  toolsClient: {
    market: {
      connectGetAuthorizeUrl: { query: connectGetAuthorizeUrlQueryMock },
      connectGetStatus: { query: connectGetStatusQueryMock },
      connectRevoke: { mutate: connectRevokeMutateMock },
    },
  },
}));

describe('useSocialConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    scanClaimableResourcesQueryMock.mockResolvedValue({ plugins: [], skills: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should keep polling after callback notification until the profile becomes available', async () => {
    const onConnectSuccess = vi.fn();

    connectGetStatusQueryMock.mockResolvedValueOnce({ connected: false }).mockResolvedValueOnce({
      connected: true,
      connection: { providerUsername: 'octocat' },
    });

    const { result } = renderHook(() =>
      useSocialConnect({
        onConnectSuccess,
        provider: 'github',
      }),
    );

    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          provider: 'github',
          type: 'SOCIAL_PROFILE_AUTH_CALLBACK',
        },
      });

      Object.defineProperty(event, 'origin', {
        configurable: true,
        value: window.location.origin,
      });

      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(1);
    expect(result.current.isConnecting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });

    expect(onConnectSuccess).toHaveBeenCalledWith({
      id: 'github',
      provider: 'github',
      username: 'octocat',
    });
    expect(connectGetStatusQueryMock).toHaveBeenCalledTimes(2);
    expect(scanClaimableResourcesQueryMock).toHaveBeenCalledTimes(1);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.isConnecting).toBe(false);
  });

  it('should stop waiting and expose the callback error without polling', async () => {
    const { result } = renderHook(() =>
      useSocialConnect({
        provider: 'github',
      }),
    );

    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          error: 'Access denied',
          provider: 'github',
          type: 'SOCIAL_PROFILE_AUTH_ERROR',
        },
      });

      Object.defineProperty(event, 'origin', {
        configurable: true,
        value: window.location.origin,
      });

      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(result.current.error).toBe('Access denied');
    expect(connectGetStatusQueryMock).not.toHaveBeenCalled();
  });
});
