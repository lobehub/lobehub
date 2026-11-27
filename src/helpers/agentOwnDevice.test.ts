import { describe, expect, it } from 'vitest';

import { getAgentOwnDevice, pickOwnDeviceDirectory } from './agentOwnDevice';

describe('getAgentOwnDevice', () => {
  it('is the bound device of a heterogeneous agent targeting it', () => {
    expect(
      getAgentOwnDevice({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      }),
    ).toEqual({ deviceId: 'dev-1', sandboxFallback: true });
  });

  it('keeps a device-only provider or a fixed agent off the sandbox', () => {
    expect(
      getAgentOwnDevice({ boundDeviceId: 'dev-1', heterogeneousProvider: { type: 'cursor' } }),
    ).toEqual({ deviceId: 'dev-1', sandboxFallback: false });
    expect(
      getAgentOwnDevice({
        boundDeviceId: 'dev-1',
        executionTarget: 'device',
        executionTargetSelectionPolicy: 'fixed',
        heterogeneousProvider: { type: 'codex' },
      })?.sandboxFallback,
    ).toBe(false);
  });

  it('is nothing for a regular agent or one moved off its device', () => {
    expect(getAgentOwnDevice({ boundDeviceId: 'dev-1', executionTarget: 'device' })).toBe(
      undefined,
    );
    expect(
      getAgentOwnDevice({
        boundDeviceId: 'dev-1',
        executionTarget: 'sandbox',
        heterogeneousProvider: { type: 'claude-code' },
      }),
    ).toBe(undefined);
    expect(getAgentOwnDevice({ heterogeneousProvider: { type: 'claude-code' } })).toBe(undefined);
  });
});

describe('pickOwnDeviceDirectory', () => {
  const own = { deviceId: 'dev-1', sandboxFallback: true };
  const dirs = [
    { deviceId: 'dev-2', id: 'other', ok: true },
    { deviceId: 'dev-1', id: 'mine', ok: true },
  ];

  it("picks the own device's available directory, never another device's", () => {
    expect(
      pickOwnDeviceDirectory(dirs, own, { isAvailable: (d) => d.ok, isRunnable: () => true }),
    ).toEqual({ directory: dirs[1], kind: 'directory' });
  });

  it('says whether the device is offline or has no directory', () => {
    expect(
      pickOwnDeviceDirectory(dirs, own, { isAvailable: () => false, isRunnable: () => true }),
    ).toEqual({ kind: 'unavailable', reason: 'offline' });
    expect(
      pickOwnDeviceDirectory(dirs, own, {
        isAvailable: () => true,
        isRunnable: (d) => d.id !== 'mine',
      }),
    ).toEqual({ kind: 'unavailable', reason: 'noDirectory' });
  });
});
