/**
 * The Composio connection list and per-app tool catalog are replicas whose sync
 * hooks are mounted on broad surfaces (ChatInput, settings, onboarding,
 * recommendations). The SWR hooks this slice replaced explicitly set
 * `revalidateOnFocus: false`; the replica syncs must keep that schedule, or a
 * window refocus would add recurring `getComposioPlugins` / `getActions` traffic.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToolStore } from '../../store';

// Capture the schedule the replica fetch driver hands to SWR. Only the driver
// binding is replaced; the slice under test is the real one.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

describe('composio replica sync schedule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not refetch the connections or the app tools on window focus', async () => {
    const { useClientDataSWR } = await import('@/libs/swr');

    renderHook(() => {
      useToolStore.getState().useFetchUserComposioConnections(true);
      useToolStore.getState().useFetchAppTools('gmail');
    });

    const syncConfigs = vi
      .mocked(useClientDataSWR)
      .mock.calls.filter(([key]) => Array.isArray(key) && key[0] === 'replica:sync')
      .map(([, , config]) => config as { revalidateOnFocus?: boolean });

    expect(syncConfigs).toHaveLength(2);
    for (const config of syncConfigs) expect(config.revalidateOnFocus).toBe(false);
  });
});
