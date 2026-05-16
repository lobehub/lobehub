import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDefaultApp } from './apps';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

vi.mock('@/services/electron/openInApp', () => ({
  electronOpenInAppService: {
    detectApps: vi.fn(),
    openInApp: vi.fn(),
  },
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}::${JSON.stringify(opts)}` : key,
  }),
}));

const updatePreferenceMock = vi.fn();
let mockUserDefault: string | undefined;

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => {
    const state = {
      preference: { defaultOpenInApp: mockUserDefault },
      updatePreference: updatePreferenceMock,
    };
    return selector(state);
  },
}));

vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: {
    defaultOpenInApp: (s: { preference: { defaultOpenInApp?: string } }) =>
      s.preference.defaultOpenInApp,
  },
}));

// Use a fresh SWR cache per test via a wrapper to avoid cross-test pollution.
beforeEach(() => {
  vi.clearAllMocks();
  mockUserDefault = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveDefaultApp', () => {
  it('returns user preference when installed', () => {
    const installed = new Set(['vscode', 'finder']);
    expect(resolveDefaultApp('vscode', installed, 'darwin')).toBe('vscode');
  });

  it('falls back to platform default when user preference is not installed', () => {
    const installed = new Set(['finder']);
    expect(resolveDefaultApp('vscode', installed, 'darwin')).toBe('finder');
  });

  it('returns platform default when user preference is null', () => {
    const installed = new Set(['finder', 'vscode']);
    expect(resolveDefaultApp(null, installed, 'darwin')).toBe('finder');
  });

  it('returns first installed when platform default is not installed', () => {
    const installed = new Set(['vscode', 'cursor']);
    expect(resolveDefaultApp(undefined, installed, 'darwin')).toBe('vscode');
  });

  it('falls back to platform fallback id when no apps are installed', () => {
    const installed = new Set<string>();
    expect(resolveDefaultApp(undefined, installed, 'darwin')).toBe('finder');
    expect(resolveDefaultApp(undefined, installed, 'win32')).toBe('explorer');
    expect(resolveDefaultApp(undefined, installed, 'linux')).toBe('files');
  });
});

describe('useOpenInApp', () => {
  const importModules = async () => {
    const hookMod = await import('./useOpenInApp');
    const svc = await import('@/services/electron/openInApp');
    const msg = await import('@/components/AntdStaticMethods');
    return {
      message: msg.message,
      service: svc.electronOpenInAppService,
      useOpenInApp: hookMod.useOpenInApp,
    };
  };

  it('returns ready=false and empty installedApps while detection pending', async () => {
    const { service, useOpenInApp } = await importModules();
    // Never-resolving promise to simulate "in flight".
    (service.detectApps as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });

    expect(result.current.ready).toBe(false);
    expect(result.current.installedApps).toEqual([]);
  });

  it('filters out apps with installed=false', async () => {
    const { service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [
        { displayName: 'Finder', id: 'finder', installed: true },
        { displayName: 'VS Code', id: 'vscode', installed: true },
        { displayName: 'Cursor', id: 'cursor', installed: false },
      ],
    });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.installedApps.map((a) => a.id)).toEqual(['finder', 'vscode']);
  });

  it('persists user preference when launching a non-default app succeeds', async () => {
    mockUserDefault = 'finder';
    const { service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [
        { displayName: 'Finder', id: 'finder', installed: true },
        { displayName: 'VS Code', id: 'vscode', installed: true },
      ],
    });
    (service.openInApp as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.launch('vscode');
    });

    expect(service.openInApp).toHaveBeenCalledWith({
      appId: 'vscode',
      path: '/tmp/proj',
    });
    expect(updatePreferenceMock).toHaveBeenCalledWith({ defaultOpenInApp: 'vscode' });
  });

  it('does not update preference when launching the current default succeeds', async () => {
    mockUserDefault = 'vscode';
    const { service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [{ displayName: 'VS Code', id: 'vscode', installed: true }],
    });
    (service.openInApp as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.launch('vscode');
    });

    expect(updatePreferenceMock).not.toHaveBeenCalled();
  });

  it('surfaces a pathNotFound toast when main reports Path not found', async () => {
    const { message, service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [{ displayName: 'VS Code', id: 'vscode', installed: true }],
    });
    (service.openInApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: 'Path not found: /tmp/proj',
      success: false,
    });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.launch('vscode');
    });

    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('errors.pathNotFound'));
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('/tmp/proj'));
  });

  it('surfaces an appNotInstalled toast when main reports X is not installed', async () => {
    const { message, service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [{ displayName: 'VS Code', id: 'vscode', installed: true }],
    });
    // Match the actual main-process controller contract: `${appId} is not installed`
    // (see apps/desktop/src/main/controllers/OpenInAppCtr.ts).
    (service.openInApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: 'vscode is not installed',
      success: false,
    });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.launch('vscode');
    });

    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('errors.appNotInstalled'));
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('VS Code'));
  });

  it('surfaces a generic launchFailed toast for unknown errors', async () => {
    const { message, service, useOpenInApp } = await importModules();
    (service.detectApps as ReturnType<typeof vi.fn>).mockResolvedValue({
      apps: [{ displayName: 'VS Code', id: 'vscode', installed: true }],
    });
    (service.openInApp as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: 'spawn ENOENT',
      success: false,
    });

    const { result } = renderHook(() => useOpenInApp('/tmp/proj'), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.launch('vscode');
    });

    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('errors.launchFailed'));
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('spawn ENOENT'));
  });
});
