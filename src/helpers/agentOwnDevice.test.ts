import { describe, expect, it } from 'vitest';

import {
  getAgentOwnDevice,
  pickOwnDeviceDirectory,
  projectTopicFallsBackToSandbox,
} from './agentOwnDevice';

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
  const pick = (options: Partial<Parameters<typeof pickOwnDeviceDirectory>[2]>) =>
    pickOwnDeviceDirectory(dirs, own, {
      deviceOnline: true,
      isAvailable: (d) => d.ok,
      isRunnable: () => true,
      ...options,
    });

  it("picks the own device's available directory, never another device's", () => {
    expect(pick({})).toEqual({ directory: dirs[1], kind: 'directory' });
  });

  // Lin (11-27): no project folder on the device is no reason to leave it.
  it("uses the agent's own working directory on an online device without a project folder", () => {
    expect(pick({ isRunnable: (d) => d.id !== 'mine' })).toEqual({ kind: 'workingDirectory' });
  });

  it('is unavailable only while the device is offline', () => {
    expect(pick({ deviceOnline: false, isAvailable: () => false })).toEqual({
      kind: 'unavailable',
      reason: 'offline',
    });
  });
});

describe('projectTopicFallsBackToSandbox', () => {
  const claudeCode = {
    boundDeviceId: 'dev-1',
    executionTarget: 'device',
    heterogeneousProvider: { type: 'claude-code' },
  };
  const topic = { projectId: 'prj' };

  it('follows the conversation marked by its run, whatever the device does now', () => {
    expect(
      projectTopicFallsBackToSandbox(
        claudeCode,
        { ...topic, metadata: { projectSandboxFallback: true } },
        true,
      ),
    ).toBe(true);
  });

  it('decides a conversation that never ran on a machine by the device presence', () => {
    expect(projectTopicFallsBackToSandbox(claudeCode, topic, false)).toBe(true);
    expect(projectTopicFallsBackToSandbox(claudeCode, topic, true)).toBe(false);
    expect(projectTopicFallsBackToSandbox(claudeCode, topic, undefined)).toBe(false);
    expect(
      projectTopicFallsBackToSandbox(
        claudeCode,
        { ...topic, metadata: { boundDeviceId: 'dev-1' } },
        false,
      ),
    ).toBe(false);
  });
});
