import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePermissionStatuses } from './usePermissionStatuses';

const { broadcastHandlers, ipc } = vi.hoisted(() => {
  const ipc = {
    notification: {
      getNotificationPermissionStatus: vi.fn(async () => 'denied'),
      requestNotificationPermission: vi.fn(async () => undefined),
    },
    system: {
      getAccessibilityStatus: vi.fn(async () => false),
      getAppState: vi.fn(async () => ({ platform: 'darwin' })),
      getFullDiskAccessStatus: vi.fn(async () => false),
      getMediaAccessStatus: vi.fn(async (_type: string) => 'denied'),
      promptFullDiskAccessIfNotGranted: vi.fn(async () => 'opened_settings'),
      requestAccessibilityAccess: vi.fn(async () => false),
      requestMicrophoneAccess: vi.fn(async () => false),
      requestScreenAccess: vi.fn(async () => false),
    },
  };
  return { broadcastHandlers: new Map<string, (data?: any) => void>(), ipc };
});

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: (data?: any) => void) => {
    broadcastHandlers.set(event, handler);
  },
}));

vi.mock('@/utils/electron/ipc', () => ({ ensureElectronIpc: () => ipc }));

const broadcast = (event: string, data?: unknown) =>
  act(() => {
    broadcastHandlers.get(event)?.(data);
  });

describe('usePermissionStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastHandlers.clear();
    ipc.system.getAccessibilityStatus.mockResolvedValue(false);
    ipc.system.getMediaAccessStatus.mockResolvedValue('denied');
  });

  it('keeps a guided row actionable until the guide reports it opened', async () => {
    const { result } = renderHook(() => usePermissionStatuses());

    await act(() => result.current.request('accessibility'));
    expect(result.current.statuses.accessibility).toBe('idle');

    await broadcast('permissionGuideChanged', { permission: 'accessibility', status: 'active' });
    expect(result.current.statuses.accessibility).toBe('pending');
  });

  it('marks a guided row granted when the guide reports success', async () => {
    const { result } = renderHook(() => usePermissionStatuses());
    await broadcast('permissionGuideChanged', { permission: 'screen', status: 'active' });

    ipc.system.getMediaAccessStatus.mockImplementation(async (type: string) =>
      type === 'screen' ? 'granted' : 'denied',
    );
    await broadcast('permissionGuideChanged', { permission: 'screen', status: 'granted' });

    await waitFor(() => expect(result.current.statuses.screen).toBe('granted'));
  });

  it('offers to continue when the guide closes before granting', async () => {
    const { result } = renderHook(() => usePermissionStatuses());
    await broadcast('permissionGuideChanged', { permission: 'fullDisk', status: 'active' });

    await broadcast('permissionGuideChanged', { permission: 'fullDisk', status: 'dismissed' });

    expect(result.current.statuses.fullDisk).toBe('incomplete');
  });

  it('shows a prompt-based row as pending, then incomplete when access is refused', async () => {
    let resolveRequest!: () => void;
    ipc.system.requestMicrophoneAccess.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => resolve(false);
        }),
    );
    const { result } = renderHook(() => usePermissionStatuses());

    let pendingRequest!: Promise<void>;
    act(() => {
      pendingRequest = result.current.request('microphone');
    });
    expect(result.current.statuses.microphone).toBe('pending');

    await act(async () => {
      resolveRequest();
      await pendingRequest;
    });
    expect(result.current.statuses.microphone).toBe('incomplete');
  });

  it('keeps a pending row pending when the window regains focus before access is granted', async () => {
    const { result } = renderHook(() => usePermissionStatuses());
    await broadcast('permissionGuideChanged', { permission: 'accessibility', status: 'active' });

    await act(async () => {
      broadcastHandlers.get('windowFocused')?.();
    });

    expect(result.current.statuses.accessibility).toBe('pending');
  });
});
