import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRemoteFolderSelection } from './useRemoteFolderSelection';

const mocks = vi.hoisted(() => ({
  statPath: vi.fn(),
}));

vi.mock('@/services/device', () => ({
  deviceService: { statPath: mocks.statPath },
}));

const renderSelection = (onSelect = vi.fn()) => {
  const onClose = vi.fn();
  return {
    onClose,
    onSelect,
    ...renderHook(() =>
      useRemoteFolderSelection({
        deviceId: 'device-1',
        onClose,
        onSelect,
        scope: 'personal',
      }),
    ),
  };
};

describe('useRemoteFolderSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when the device omits its normalized path', async () => {
    mocks.statPath.mockResolvedValue({ exists: true, isDirectory: true, path: '' });
    const selection = renderSelection();

    await act(() => selection.result.current.confirmPath('/home/alice/projects'));

    expect(selection.result.current.error).toBe('UNAVAILABLE');
    expect(selection.onSelect).not.toHaveBeenCalled();
    expect(selection.onClose).not.toHaveBeenCalled();
  });

  it('retries a failed save with the same device-normalized directory', async () => {
    const candidate = '~/projects/new-project';
    const normalized = '/home/alice/projects/new-project';
    mocks.statPath.mockImplementation(async (_deviceId, _scope, path) => ({
      exists: true,
      isDirectory: true,
      path: path === candidate ? normalized : path,
    }));
    const onSelect = vi
      .fn()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(undefined);
    const selection = renderSelection(onSelect);

    await act(() => selection.result.current.confirmPath(candidate));
    expect(selection.result.current.error).toBe('SAVE_FAILED');

    await act(() => selection.result.current.retrySave());

    expect(mocks.statPath.mock.calls.map((call) => call[2])).toEqual([candidate, normalized]);
    expect(onSelect).toHaveBeenNthCalledWith(1, { path: normalized, repoType: undefined });
    expect(onSelect).toHaveBeenNthCalledWith(2, { path: normalized, repoType: undefined });
    expect(selection.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not persist after the picker unmounts during remote validation', async () => {
    let resolveStat!: (result: { exists: boolean; isDirectory: boolean; path: string }) => void;
    mocks.statPath.mockReturnValue(
      new Promise((resolve) => {
        resolveStat = resolve;
      }),
    );
    const selection = renderSelection();
    let confirmation!: Promise<void>;

    act(() => {
      confirmation = selection.result.current.confirmPath('/home/alice/projects');
    });
    selection.unmount();
    resolveStat({ exists: true, isDirectory: true, path: '/home/alice/projects' });
    await confirmation;

    expect(selection.onSelect).not.toHaveBeenCalled();
    expect(selection.onClose).not.toHaveBeenCalled();
  });
});
