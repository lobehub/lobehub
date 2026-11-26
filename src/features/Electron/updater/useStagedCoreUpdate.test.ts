import type { CoreUpdateStatus } from '@lobechat/electron-client-ipc';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStagedCoreUpdate } from './useStagedCoreUpdate';

const handlers = new Map<string, (data: any) => void>();

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: (data: any) => void) => {
    handlers.set(event, handler);
  },
}));

const getStatus = vi.fn<() => Promise<CoreUpdateStatus>>();

vi.mock('@/services/electron/rendererOta', () => ({
  rendererOtaService: { getStatus: () => getStatus() },
}));

const status = (patch: Partial<CoreUpdateStatus>): CoreUpdateStatus => ({
  applyMode: null,
  current: null,
  disabledReasons: [],
  enabled: true,
  lastCheckAt: null,
  lastError: null,
  needsFullRelease: false,
  running: '2.3.4-canary.1-core.38',
  staged: null,
  ...patch,
});

const emit = (event: string, data?: unknown) => act(() => handlers.get(event)?.(data));

beforeEach(() => {
  handlers.clear();
  getStatus.mockReset();
});

describe('useStagedCoreUpdate', () => {
  it('reports a core update staged before the page mounted', async () => {
    getStatus.mockResolvedValue(
      status({ applyMode: 'relaunch', staged: '2.3.4-canary.1-core.45' }),
    );

    const { result } = renderHook(() => useStagedCoreUpdate(true));

    await waitFor(() =>
      expect(result.current).toEqual({ applyMode: 'relaunch', version: '2.3.4-canary.1-core.45' }),
    );
  });

  it('picks up a core update staged while the page is open, ignoring full app updates', async () => {
    getStatus.mockResolvedValue(status({}));
    const { result } = renderHook(() => useStagedCoreUpdate(true));
    await waitFor(() => expect(getStatus).toHaveBeenCalled());

    emit('updateReady', { kind: 'app', version: '2.3.5' });
    expect(result.current).toBeNull();

    emit('updateReady', { kind: 'core-reload', version: '2.3.4-canary.1-core.46' });
    expect(result.current).toEqual({ applyMode: 'reload', version: '2.3.4-canary.1-core.46' });
  });

  it('keeps a broadcast update when an older status read resolves afterwards', async () => {
    let resolveStatus!: (value: CoreUpdateStatus) => void;
    getStatus.mockReturnValue(new Promise((resolve) => (resolveStatus = resolve)));
    const { result } = renderHook(() => useStagedCoreUpdate(true));

    emit('updateReady', { kind: 'core-relaunch', version: '2.3.4-canary.1-core.45' });
    await act(async () => resolveStatus(status({})));

    expect(result.current).toEqual({ applyMode: 'relaunch', version: '2.3.4-canary.1-core.45' });
  });

  it('clears the staged update once that version is applied', async () => {
    getStatus.mockResolvedValue(status({ applyMode: 'reload', staged: '2.3.4-canary.1-core.45' }));
    const { result } = renderHook(() => useStagedCoreUpdate(true));
    await waitFor(() => expect(result.current).not.toBeNull());

    emit('coreUpdateApplied', '2.3.4-canary.1-core.44');
    expect(result.current).not.toBeNull();

    emit('coreUpdateApplied', '2.3.4-canary.1-core.45');
    expect(result.current).toBeNull();
  });

  it('drops the staged update when the update channel changes', async () => {
    getStatus.mockResolvedValue(
      status({ applyMode: 'relaunch', staged: '2.3.4-canary.1-core.45' }),
    );
    const { result } = renderHook(() => useStagedCoreUpdate(true));
    await waitFor(() => expect(result.current).not.toBeNull());

    emit('updateChannelChanged', 'stable');
    expect(result.current).toBeNull();
  });

  it('does not query core OTA status outside the desktop app', () => {
    const { result } = renderHook(() => useStagedCoreUpdate(false));

    expect(getStatus).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
