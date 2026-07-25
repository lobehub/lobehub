import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STALE_RUNNING_TOPIC_TIMEOUT } from '@/const/topic';
import { useClientDataSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';

import { useHomeInboxTopics } from './useHomeInboxTopics';

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: vi.fn(),
}));

const cleanupStaleRunningTopics = vi.fn();
const mutate = vi.fn();
const now = new Date('2026-07-25T04:00:00Z').getTime();

const createTopic = (updatedAt: Date, runStartedAt?: Date) => ({
  createdAt: updatedAt,
  id: 'topic-1',
  runStartedAt,
  status: 'running' as const,
  title: 'Running topic',
  updatedAt,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  cleanupStaleRunningTopics.mockReset();
  cleanupStaleRunningTopics.mockResolvedValue(0);
  mutate.mockReset();
  useChatStore.setState({ cleanupStaleRunningTopics });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useHomeInboxTopics', () => {
  it('should run cleanup at the stale threshold and revalidate after repairs', async () => {
    cleanupStaleRunningTopics.mockResolvedValue(1);
    vi.mocked(useClientDataSWR).mockReturnValue({
      data: [createTopic(new Date(now - STALE_RUNNING_TOPIC_TIMEOUT + 1000))],
      error: undefined,
      isLoading: false,
      mutate,
    } as never);

    renderHook(() => useHomeInboxTopics(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(cleanupStaleRunningTopics).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(cleanupStaleRunningTopics).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('should schedule old running operation rows instead of treating them as live', async () => {
    vi.mocked(useClientDataSWR).mockReturnValue({
      data: [createTopic(new Date(now - STALE_RUNNING_TOPIC_TIMEOUT), new Date(now - 1000))],
      error: undefined,
      isLoading: false,
      mutate,
    } as never);

    renderHook(() => useHomeInboxTopics(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(cleanupStaleRunningTopics).toHaveBeenCalledOnce();
  });

  it('should cancel scheduled cleanup on unmount', async () => {
    vi.mocked(useClientDataSWR).mockReturnValue({
      data: [createTopic(new Date(now - STALE_RUNNING_TOPIC_TIMEOUT + 1000))],
      error: undefined,
      isLoading: false,
      mutate,
    } as never);

    const { unmount } = renderHook(() => useHomeInboxTopics(true));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(cleanupStaleRunningTopics).not.toHaveBeenCalled();
  });
});
