import { describe, expect, it } from 'vitest';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { resolveAgentProjectRunner } from './agentProjectRunner';
import { orderExecutionEnvironments } from './executionEnvironmentOrder';

const folder = (id: string, deviceId: string) =>
  ({ deviceId, id, runnable: true, sortOrder: 0 }) as unknown as ProjectDirectory;

describe('resolveAgentProjectRunner', () => {
  // The project order puts another device's folder first.
  const ordered = orderExecutionEnvironments(
    [folder('dir-other', 'dev-2'), folder('dir-own', 'dev-1')],
    0,
  );
  const online = (ids: string[]) => ({
    isAvailable: (d: ProjectDirectory) => ids.includes(d.deviceId!),
    isDeviceOnline: (deviceId: string) => ids.includes(deviceId),
    isRunnable: () => true,
  });

  it("follows the project's order for an agent without a device of its own", () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-1', 'dev-2']),
      ownDevice: undefined,
    });
    expect(choice).toEqual({ environment: expect.objectContaining({ id: 'dir-other' }) });
  });

  it("starts on the agent's own device ahead of the order", () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-1', 'dev-2']),
      ownDevice: { deviceId: 'dev-1', sandboxFallback: true },
    });
    expect(choice.environment.id).toBe('dir-own');
    expect(choice.notice).toBeUndefined();
  });

  it('falls back to the sandbox, not another device, while its device is offline', () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-2']),
      ownDevice: { deviceId: 'dev-1', sandboxFallback: true },
    });
    expect(choice).toEqual({
      blocked: undefined,
      environment: { id: 'sandbox', kind: 'sandbox' },
      notice: { blocked: false, reason: 'offline' },
    });
  });

  // Lin (11-27): a device without a project folder still runs the agent, in
  // its own working directory there.
  it("starts in the agent's own working directory on an online device without a project folder", () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-2', 'dev-3']),
      ownDevice: { deviceId: 'dev-3', sandboxFallback: false },
    });
    expect(choice).toMatchObject({
      notice: { deviceId: 'dev-3', workingDirectory: true },
      ownWorkingDirectory: true,
    });
    expect(choice.blocked).toBeUndefined();
  });

  it('blocks a device-only agent whose device is offline', () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-2']),
      ownDevice: { deviceId: 'dev-3', sandboxFallback: false },
    });
    expect(choice).toMatchObject({ blocked: true, notice: { blocked: true, reason: 'offline' } });
  });

  it('keeps a pick made by hand', () => {
    const choice = resolveAgentProjectRunner(ordered, 'dir-other', {
      ...online([]),
      ownDevice: { deviceId: 'dev-1', sandboxFallback: false },
    });
    expect(choice).toEqual({ environment: expect.objectContaining({ id: 'dir-other' }) });
  });
});
