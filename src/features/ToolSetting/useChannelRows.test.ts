import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSaveState } from '@/hooks/useSaveState';

import { useChannelRows } from './useChannelRows';

const mockSetSettings = vi.hoisted(() => vi.fn());
const mockUseUserStore = vi.hoisted(() => vi.fn());

vi.mock('@/store/user', () => ({
  useUserStore: mockUseUserStore,
}));

vi.mock('@/store/user/slices/settings/selectors', () => ({
  settingsSelectors: {
    currentSettings: (state: { settings: { tool: { searchProviders: string[] } } }) =>
      state.settings,
  },
}));

const useSubject = () => {
  const { status, lastSavedAt, retry, save } = useSaveState();
  const channelRows = useChannelRows('searchProviders', ['searxng', 'google'], save);

  return { ...channelRows, lastSavedAt, retry, status };
};

describe('useChannelRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserStore.mockImplementation((selector) =>
      selector({
        setSettings: mockSetSettings,
        settings: { tool: { searchProviders: ['searxng'] } },
      }),
    );
  });

  it('keeps the local change visible and retries a failed preference save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetSettings.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(useSubject);

    act(() => {
      result.current.toggle('google', true);
    });

    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.rows).toEqual([
      { enabled: true, id: 'searxng' },
      { enabled: true, id: 'google' },
    ]);
    expect(mockSetSettings).toHaveBeenLastCalledWith({
      tool: { searchProviders: ['searxng', 'google'] },
    });

    mockSetSettings.mockResolvedValueOnce(undefined);
    await act(async () => result.current.retry());

    expect(result.current.status).toBe('saved');
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
    expect(mockSetSettings).toHaveBeenCalledTimes(2);
    expect(mockSetSettings).toHaveBeenLastCalledWith({
      tool: { searchProviders: ['searxng', 'google'] },
    });
  });
});
