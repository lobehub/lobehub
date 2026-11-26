import type { MainBroadcastParams } from '@lobechat/electron-client-ipc';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import DesktopNavigationBridge from './index';

type NavigatePayload = MainBroadcastParams<'navigate'>;
type NavigateHandler = (payload: NavigatePayload) => void;
type OpenDirectoryPayload = { newWindow: boolean; path: string };
type OpenDirectoryHandler = (payload: OpenDirectoryPayload) => void;

let registeredHandler: NavigateHandler | null = null;
let openDirectoryHandler: OpenDirectoryHandler | null = null;

const navigateMock = vi.hoisted(() => vi.fn());
const openDirectoryInAppMock = vi.hoisted(() => vi.fn());
const clientReadyMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: any) => {
    if (event === 'navigate') registeredHandler = handler;
    if (event === 'openDirectory') openDirectoryHandler = handler;
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/features/AppLaunch/openDirectory', () => ({
  openDirectoryInApp: openDirectoryInAppMock,
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ appLaunch: { clientReady: clientReadyMock } }),
}));

const emitNavigate = (payload: NavigatePayload) => {
  act(() => {
    registeredHandler?.(payload);
  });
};

const emitOpenDirectory = (payload: OpenDirectoryPayload) => {
  act(() => {
    openDirectoryHandler?.(payload);
  });
};

describe('DesktopNavigationBridge', () => {
  beforeEach(() => {
    registeredHandler = null;
    openDirectoryHandler = null;
    navigateMock.mockReset();
    openDirectoryInAppMock.mockReset();
    openDirectoryInAppMock.mockResolvedValue(undefined);
    clientReadyMock.mockReset();
    clientReadyMock.mockResolvedValue(false);
  });

  it('opens a notification in the tab list for its original workspace', () => {
    localStorage.clear();
    const target = '/team/agent/a1/t1';
    const store = useElectronStore.getState();
    const targetId = store.addTab(target);
    store.addTab('/team/page/notes');
    store.addTab('/agent/personal');
    render(<DesktopNavigationBridge />);

    emitNavigate({ escape: true, path: target, reuseTab: true });

    expect(useElectronStore.getState().activeTabId).toBe(targetId);
    expect(useElectronStore.getState().tabs.map((tab) => tab.url)).toEqual([
      target,
      '/team/page/notes',
    ]);

    emitNavigate({ escape: true, path: '/team/agent/a1/t2', reuseTab: true });

    expect(useElectronStore.getState().getActiveTab()?.url).toBe('/team/agent/a1/t2');
    const newTabId = useElectronStore.getState().activeTabId;
    emitNavigate({ escape: true, path: '/team/agent/a1/t2#message', reuseTab: true });
    expect(useElectronStore.getState().activeTabId).toBe(newTabId);
    expect(useElectronStore.getState().getActiveTab()?.url).toBe('/team/agent/a1/t2#message');
    expect(useElectronStore.getState().tabs).toHaveLength(3);
    const duplicate = store.addNewTab(target);
    emitNavigate({ escape: true, path: target, reuseTab: true });
    expect(useElectronStore.getState().activeTabId).toBe(duplicate);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('uses escaped navigation for literal desktop notification paths', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ escape: true, path: '/team/agent/a1/t1' });

    expect(navigateMock).toHaveBeenCalledWith('/team/agent/a1/t1', {
      escape: true,
      replace: false,
    });
  });

  it('preserves replace navigation options from desktop broadcasts', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '/agent/a1', replace: true });

    expect(navigateMock).toHaveBeenCalledWith('/agent/a1', {
      escape: false,
      replace: true,
    });
  });

  it('keeps legacy broadcasts as plain workspace-aware navigation', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '/agent/a1/t1' });

    expect(navigateMock).toHaveBeenCalledWith('/agent/a1/t1');
  });

  it('ignores empty navigation paths', () => {
    render(<DesktopNavigationBridge />);

    emitNavigate({ path: '' });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('reveals the conversation bound to a launched directory', () => {
    render(<DesktopNavigationBridge />);

    emitOpenDirectory({ newWindow: false, path: '/repo' });

    expect(openDirectoryInAppMock).toHaveBeenCalledWith({
      navigate: navigateMock,
      reuseExisting: true,
      targetPath: '/repo',
    });
  });

  it('starts a fresh conversation when the launch asks for a new window', () => {
    render(<DesktopNavigationBridge />);

    emitOpenDirectory({ newWindow: true, path: '/repo' });

    // `--new-window` means "do not take over the conversation I already have".
    expect(openDirectoryInAppMock).toHaveBeenCalledWith({
      navigate: navigateMock,
      reuseExisting: false,
      targetPath: '/repo',
    });
  });

  it('tells the main process the launch listeners exist', () => {
    // A cold start holds the directory until this handshake; without it the
    // broadcast is sent into a page that has not subscribed and is dropped.
    render(<DesktopNavigationBridge />);

    expect(clientReadyMock).toHaveBeenCalled();
  });
});
