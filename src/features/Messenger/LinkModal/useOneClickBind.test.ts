import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messengerKeys } from '@/libs/swr/keys';

import { useOneClickBind } from './useOneClickBind';

const messengerServiceMocks = vi.hoisted(() => ({
  pollBind: vi.fn(),
  startBind: vi.fn(),
}));

const swrMutate = vi.hoisted(() => vi.fn());

// Spy on the cache-bound mutate the hook uses to refresh the detail page;
// `useSWR` itself stays real.
vi.mock('swr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSWRConfig: () => ({ mutate: swrMutate }),
}));

vi.mock('@/services/messenger', () => ({ messengerService: messengerServiceMocks }));

const TELEGRAM_URL = 'https://t.me/LobeHubBot?start=TG_0123456789ABCDEF01234567';

const deeplinkStart = (pollId = 'poll-1') => ({
  expiresAt: Date.now() + 60_000,
  kind: 'deeplink' as const,
  payload: { qrValue: TELEGRAM_URL, url: TELEGRAM_URL },
  platform: 'telegram' as const,
  pollId,
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

describe('useOneClickBind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messengerServiceMocks.pollBind.mockResolvedValue({ status: 'pending' });
  });

  it('starts the bind in the page locale and polls it while pending', async () => {
    messengerServiceMocks.startBind.mockResolvedValue(deeplinkStart());

    const { result } = renderHook(() => useOneClickBind('telegram', 'zh-CN'), { wrapper });

    await waitFor(() => expect(result.current.start?.pollId).toBe('poll-1'));
    expect(messengerServiceMocks.startBind).toHaveBeenCalledWith({
      locale: 'zh-CN',
      platform: 'telegram',
    });
    await waitFor(() => expect(messengerServiceMocks.pollBind).toHaveBeenCalledWith('poll-1'));
    expect(result.current.status).toBe('pending');
    expect(swrMutate).not.toHaveBeenCalled();
    expect(result.current.failedReason).toBeUndefined();
  });

  it('reports linked and refreshes the link and install lists once the poll settles', async () => {
    messengerServiceMocks.startBind.mockResolvedValue(deeplinkStart());
    messengerServiceMocks.pollBind.mockResolvedValue({
      link: { id: 'link-1' },
      linkedAt: 1,
      platform: 'telegram',
      platformUserId: '42',
      status: 'linked',
    });
    const { result } = renderHook(() => useOneClickBind('telegram', 'en-US'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('linked'));
    expect(result.current.failedReason).toBeUndefined();
    expect(swrMutate).toHaveBeenCalledWith(messengerKeys.listMyLinks());
    expect(swrMutate).toHaveBeenCalledWith(messengerKeys.listMyInstallations());
  });

  it('surfaces the refusal reason of a failed bind', async () => {
    messengerServiceMocks.startBind.mockResolvedValue({
      expiresAt: Date.now() + 60_000,
      kind: 'oauth',
      payload: { url: 'https://app.test/install' },
      platform: 'discord',
      pollId: 'poll-3',
    });
    messengerServiceMocks.pollBind.mockResolvedValue({
      link: null,
      platform: 'discord',
      reason: 'already_linked_to_other',
      status: 'failed',
    });

    const { result } = renderHook(() => useOneClickBind('discord', 'en-US'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.failedReason).toBe('already_linked_to_other');
  });

  it('exposes a polling failure instead of reporting pending forever', async () => {
    messengerServiceMocks.startBind.mockResolvedValue(deeplinkStart('poll-err'));
    messengerServiceMocks.pollBind.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useOneClickBind('telegram', 'en-US'), { wrapper });

    await waitFor(() => expect(result.current.pollError).toBeInstanceOf(Error));
    expect((result.current.pollError as Error).message).toBe('network down');
  });

  it('exposes a start failure without polling', async () => {
    messengerServiceMocks.startBind.mockRejectedValue(new Error('not configured'));

    const { result } = renderHook(() => useOneClickBind('slack', 'en-US'), { wrapper });

    await waitFor(() => expect(result.current.startError).toBeInstanceOf(Error));
    expect(result.current.start).toBeUndefined();
    expect(messengerServiceMocks.pollBind).not.toHaveBeenCalled();
  });

  it('mints a fresh bind when the modal is reopened after a settled bind', async () => {
    messengerServiceMocks.startBind
      .mockResolvedValueOnce(deeplinkStart('poll-first'))
      .mockResolvedValueOnce(deeplinkStart('poll-second'));
    messengerServiceMocks.pollBind.mockResolvedValue({
      link: { id: 'link-1' },
      linkedAt: 1,
      platform: 'telegram',
      platformUserId: '42',
      status: 'linked',
    });
    // One SWR cache shared by both mounts, like the app-level provider.
    const cache = new Map();
    const sharedWrapper = ({ children }: { children: ReactNode }) =>
      createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => cache } }, children);

    const first = renderHook(() => useOneClickBind('telegram', 'en-US'), {
      wrapper: sharedWrapper,
    });
    await waitFor(() => expect(first.result.current.status).toBe('linked'));
    first.unmount();

    const second = renderHook(() => useOneClickBind('telegram', 'en-US'), {
      wrapper: sharedWrapper,
    });
    await waitFor(() => expect(second.result.current.start?.pollId).toBe('poll-second'));
    expect(messengerServiceMocks.startBind).toHaveBeenCalledTimes(2);
  });

  it('mints a fresh bind on retry', async () => {
    messengerServiceMocks.startBind
      .mockResolvedValueOnce(deeplinkStart('poll-1'))
      .mockResolvedValueOnce(deeplinkStart('poll-2'));

    const { result } = renderHook(() => useOneClickBind('telegram', 'en-US'), { wrapper });
    await waitFor(() => expect(result.current.start?.pollId).toBe('poll-1'));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.start?.pollId).toBe('poll-2'));
    expect(messengerServiceMocks.startBind).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(messengerServiceMocks.pollBind).toHaveBeenCalledWith('poll-2'));
  });
});
