import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';

import { PROJECT_TOPICS_POLL_INTERVAL, useProjectDirectoryStore } from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'scope',
  useCacheScope: () => 'scope',
}));

/** Render the hook and hand back the `refreshInterval` it registered with SWR. */
const registeredRefreshInterval = () => {
  vi.mocked(useClientDataSWR).mockReturnValue({ data: undefined } as any);

  renderHook(() => useProjectDirectoryStore.getState().useFetchProjectTopics('project-1'));

  return vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[2]?.refreshInterval as
    ((data?: { data?: { status?: null | string }[] }) => number) | undefined;
};

describe('projectWorkingDirectory store', () => {
  describe('useFetchProjectTopics polling', () => {
    it('polls while a project conversation is in flight only', () => {
      const refreshInterval = registeredRefreshInterval();

      expect(refreshInterval).toBeTypeOf('function');
      // Nothing fetched yet — nothing to poll for.
      expect(refreshInterval?.()).toBe(0);
      // Work in flight: the server may still settle these.
      expect(refreshInterval?.({ data: [{ status: 'running' }] })).toBe(
        PROJECT_TOPICS_POLL_INTERVAL,
      );
      expect(refreshInterval?.({ data: [{ status: 'waitingForHuman' }] })).toBe(
        PROJECT_TOPICS_POLL_INTERVAL,
      );
      // A settled project never re-reads its whole history on a timer.
      expect(
        refreshInterval?.({
          data: [
            { status: 'active' },
            { status: 'completed' },
            { status: 'unread' },
            { status: null },
          ],
        }),
      ).toBe(0);
      expect(refreshInterval?.({ data: [] })).toBe(0);
    });
  });
});
