import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const device = vi.hoisted(() => ({ confirmed: false, loaded: false }));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    isDeviceListConfirmed: (s: { confirmed: boolean }) => s.confirmed,
    isDeviceListLoaded: (s: { loaded: boolean }) => s.loaded,
  },
  useDeviceStore: (selector: (s: { confirmed: boolean; loaded: boolean }) => boolean) =>
    selector(device),
}));

vi.mock('../useRememberedFilesLocation', () => ({
  filesLocationContextKey: (topicId?: string, agentId?: string) =>
    topicId ? `topic/${topicId}` : agentId ? `agent/${agentId}` : undefined,
  useRememberedFilesLocation: (...args: unknown[]) => {
    captured.calls.push(args);
    return undefined;
  },
}));

const { useFilesPaneLocation } = await import('../useFilesPaneLocation');

const base = {
  activeAgentId: 'agent-1',
  sandboxDirectory: '',
  sandboxDirectoryKnown: false,
  topicId: 'tpc_1',
};

beforeEach(() => {
  captured.calls.length = 0;
  device.confirmed = false;
  device.loaded = false;
});

describe('useFilesPaneLocation', () => {
  it('does not consult a remembered filesystem path when the environment cannot read one', () => {
    const { result } = renderHook(() =>
      useFilesPaneLocation({
        ...base,
        filesystemEnvironmentAvailable: false,
        isSandboxExecution: true,
        sandboxDirectoryKnown: true,
        sandboxInstanceId: 'instance-1',
      }),
    );

    // Neither the conversation key nor a resolved location reaches the hook,
    // so a saved local directory cannot enable Files in a sandbox.
    expect(captured.calls[0][0]).toBeUndefined();
    expect(captured.calls[0][1]).toBeUndefined();
    expect(result.current).toEqual({ deviceId: undefined, directory: '', isSandbox: true });
  });

  it('waits for a server-confirmed device list before settling the path', () => {
    // A persisted device list counts as loaded, but its `workingDirs` are
    // stale. Settling on it would drop the remembered directory before the
    // server answers, so the hook must pass `settled: false` until confirmed.
    device.loaded = true;
    device.confirmed = false;

    renderHook(() =>
      useFilesPaneLocation({
        ...base,
        filesystemEnvironmentAvailable: true,
        isSandboxExecution: false,
        workingDirectory: '/from-stale-device-list',
      }),
    );

    expect(captured.calls[0][2]).toBe(false);

    device.confirmed = true;
    renderHook(() =>
      useFilesPaneLocation({
        ...base,
        filesystemEnvironmentAvailable: true,
        isSandboxExecution: false,
        workingDirectory: '/from-stale-device-list',
      }),
    );
    expect(captured.calls[1][2]).toBe(true);
  });

  it('keeps the known remote host while its directory is still unresolved', () => {
    renderHook(() =>
      useFilesPaneLocation({
        ...base,
        filesystemEnvironmentAvailable: true,
        isSandboxExecution: false,
        remoteDeviceId: 'device-1',
        workingDirectory: undefined,
      }),
    );

    expect(captured.calls[0][0]).toBe('topic/tpc_1');
    expect(captured.calls[0][1]).toEqual({ deviceId: 'device-1', directory: undefined });
  });
});
