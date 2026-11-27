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
    expect(choice.ownDeviceUnavailable).toBeUndefined();
  });

  it('falls back to the sandbox, not another device, when it can', () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-2']),
      ownDevice: { deviceId: 'dev-1', sandboxFallback: true },
    });
    expect(choice).toEqual({
      blocked: undefined,
      environment: { id: 'sandbox', kind: 'sandbox' },
      ownDeviceUnavailable: 'offline',
    });
  });

  it('blocks a device-only agent whose device has no directory', () => {
    const choice = resolveAgentProjectRunner(ordered, undefined, {
      ...online(['dev-2', 'dev-3']),
      ownDevice: { deviceId: 'dev-3', sandboxFallback: false },
    });
    expect(choice).toMatchObject({ blocked: true, ownDeviceUnavailable: 'noDirectory' });
  });

  it('keeps a pick made by hand', () => {
    const choice = resolveAgentProjectRunner(ordered, 'dir-other', {
      ...online([]),
      ownDevice: { deviceId: 'dev-1', sandboxFallback: false },
    });
    expect(choice).toEqual({ environment: expect.objectContaining({ id: 'dir-other' }) });
  });
});
