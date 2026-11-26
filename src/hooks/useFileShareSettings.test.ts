import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setScopedMutate } from '@/libs/swr';

import { useFileShareSettings } from './useFileShareSettings';

const { activeWorkspaceIdMock, getShareSettingsMock, updateShareSettingsMock } = vi.hoisted(() => ({
  activeWorkspaceIdMock: vi.fn<() => string | null>(),
  getShareSettingsMock: vi.fn(),
  updateShareSettingsMock: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: activeWorkspaceIdMock,
  useActiveWorkspaceId: activeWorkspaceIdMock,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    fileShare: {
      getShareSettings: { query: getShareSettingsMock },
      updateShareSettings: { mutate: updateShareSettingsMock },
    },
  },
}));

const settings = (visibility: 'link' | 'private') => ({
  fileId: 'file-1',
  pageViewCount: 0,
  shareId: 'share-1',
  visibility,
});

/** Mirrors the app's SWRMutateInitializer: hands the scoped mutate to `@/libs/swr`. */
const MutateInitializer = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);
  return null;
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateInitializer),
    children,
  );

/** Two readers of one file, like the share panel and the header share button. */
const usePanelAndButton = () => ({
  button: useFileShareSettings('file-1'),
  panel: useFileShareSettings('file-1'),
});

describe('useFileShareSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShareSettingsMock.mockResolvedValue(settings('private'));
    updateShareSettingsMock.mockResolvedValue(settings('link'));
  });

  it.each([
    ['inside a workspace', 'ws-1'],
    ['in the personal space', null],
  ])('shows a visibility change to every reader at once %s', async (_, workspaceId) => {
    activeWorkspaceIdMock.mockReturnValue(workspaceId);
    const { result } = renderHook(usePanelAndButton, { wrapper });

    await waitFor(() => expect(result.current.panel.data?.visibility).toBe('private'));

    await act(async () => {
      await result.current.panel.updateVisibility('link');
    });

    expect(updateShareSettingsMock).toHaveBeenCalledWith({ fileId: 'file-1', visibility: 'link' });
    expect(result.current.panel.data?.visibility).toBe('link');
    expect(result.current.button.data?.visibility).toBe('link');
    // The write fills the cache; it does not refetch.
    expect(getShareSettingsMock).toHaveBeenCalledTimes(1);
  });

  it('skips the fetch and the write without a file', async () => {
    activeWorkspaceIdMock.mockReturnValue('ws-1');
    const { result } = renderHook(() => useFileShareSettings(undefined), { wrapper });

    await expect(result.current.updateVisibility('link')).resolves.toBeNull();
    expect(getShareSettingsMock).not.toHaveBeenCalled();
    expect(updateShareSettingsMock).not.toHaveBeenCalled();
  });
});
