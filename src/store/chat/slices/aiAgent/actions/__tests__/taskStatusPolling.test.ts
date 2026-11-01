import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat/store';

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: vi.fn(),
}));

describe('useEnablePollingTaskStatus', () => {
  it('should stop polling after a terminal task status is fetched', () => {
    vi.mocked(useClientDataSWR).mockReturnValue({ data: undefined } as any);

    const useEnablePollingTaskStatus = useChatStore.getState().useEnablePollingTaskStatus;
    renderHook(() => useEnablePollingTaskStatus('thread-1', 'message-1', true));

    const refreshInterval = vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[2]?.refreshInterval as
      ((data?: { status?: string }) => number) | undefined;

    expect(refreshInterval).toBeTypeOf('function');
    expect(refreshInterval?.()).toBe(5000);
    expect(refreshInterval?.({ status: 'processing' })).toBe(5000);
    expect(refreshInterval?.({ status: 'completed' })).toBe(0);
    expect(refreshInterval?.({ status: 'failed' })).toBe(0);
    expect(refreshInterval?.({ status: 'cancel' })).toBe(0);
  });
});
