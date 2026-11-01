import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERSONAL_TAB_SCOPE } from '@/features/Electron/titlebar/TabBar/scope';
import { useElectronStore } from '@/store/electron';

import { openCurrentWorkspaceInNewWindow } from './openCurrentWorkspaceInNewWindow';

const createMultiInstanceWindow = vi.hoisted(() => vi.fn());

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ windows: { createMultiInstanceWindow } }),
}));

describe('openCurrentWorkspaceInNewWindow', () => {
  beforeEach(() => {
    createMultiInstanceWindow.mockReset();
    createMultiInstanceWindow.mockResolvedValue({ success: true, windowId: 'chatSingle_1' });
  });

  it('opens the active workspace home in a fresh window sized like the current one', async () => {
    useElectronStore.setState({ activeTabScope: { slug: 'acme', type: 'workspace' } });

    await openCurrentWorkspaceInNewWindow();

    expect(createMultiInstanceWindow).toHaveBeenCalledWith({
      inheritCurrentWindowSize: true,
      path: '/acme',
      templateId: 'chatSingle',
    });
  });

  it('opens the personal home when the active tab is in the personal scope', async () => {
    useElectronStore.setState({ activeTabScope: PERSONAL_TAB_SCOPE });

    await openCurrentWorkspaceInNewWindow();

    expect(createMultiInstanceWindow).toHaveBeenCalledWith(expect.objectContaining({ path: '/' }));
  });

  it('does not throw when the window cannot be created', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createMultiInstanceWindow.mockRejectedValue(new Error('ipc down'));

    await expect(openCurrentWorkspaceInNewWindow()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
