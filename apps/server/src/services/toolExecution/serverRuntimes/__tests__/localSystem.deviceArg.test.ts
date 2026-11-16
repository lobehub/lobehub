import { LocalSystemApiName, LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ManagedDeviceWake from '@/server/services/deviceGateway/managedDeviceWake';

import { type ToolExecutionContext } from '../../types';

const mocks = vi.hoisted(() => ({
  awaitManagedDeviceForToolCall: vi.fn(),
  executeToolCall: vi.fn(),
  getScopedOnlineDevices: vi.fn(),
}));

vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    mocks.executeToolCall(...args),
}));

vi.mock('@/server/services/deviceGateway/managedDeviceWake', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedDeviceWake>()),
  awaitManagedDeviceForToolCall: mocks.awaitManagedDeviceForToolCall,
}));

vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: mocks.getScopedOnlineDevices,
}));

const { localSystemRuntime } = await import('../localSystem');

const device = (deviceId: string, hostname: string, online: boolean, friendlyName?: string) => ({
  deviceId,
  friendlyName: friendlyName ?? null,
  hostname,
  lastSeen: '2026-11-17T00:00:00.000Z',
  online,
  platform: 'linux',
  scope: 'personal' as const,
});

const RUN_DEVICE = device('run-device', 'run-host', true);
const OTHER_ONLINE = device('other-device', 'other-host', true, 'Studio Mac');
const OTHER_OFFLINE = device('sleeping-device', 'sleeping-host', false);

const baseContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  activeDeviceId: RUN_DEVICE.deviceId,
  operationId: 'op-1',
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
  workingDirectory: '/home/me/repo',
  ...overrides,
});

const call = (
  args: Record<string, unknown>,
  context = baseContext(),
  apiName: string = LocalSystemApiName.readFile,
) => {
  const proxy = localSystemRuntime.factory(context) as Record<string, (a: any) => Promise<any>>;
  return proxy[apiName](args);
};

const dispatched = () => {
  const [params, toolCall] = mocks.executeToolCall.mock.calls[0];
  return { args: JSON.parse(toolCall.arguments), params };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeToolCall.mockResolvedValue({ content: 'ok', success: true });
  mocks.getScopedOnlineDevices.mockResolvedValue([RUN_DEVICE, OTHER_ONLINE, OTHER_OFFLINE]);
  mocks.awaitManagedDeviceForToolCall.mockResolvedValue(undefined);
});

describe('localSystemRuntime — per-call device argument', () => {
  it('offers the optional device argument on every api', () => {
    for (const api of LocalSystemManifest.api) {
      expect(api.parameters.properties.device).toMatchObject({ type: 'string' });
      expect(api.parameters.required ?? []).not.toContain('device');
    }
  });

  describe('no device named', () => {
    it.each([
      ['omitted', {}],
      ['null', { device: null }],
      ['blank', { device: '  ' }],
    ])('runs on the run device when the argument is %s', async (_label, deviceArg) => {
      const result = await call({ path: 'notes.md', ...deviceArg });

      expect(mocks.getScopedOnlineDevices).not.toHaveBeenCalled();
      const { args, params } = dispatched();
      expect(params.deviceId).toBe(RUN_DEVICE.deviceId);
      expect(args).toEqual({ cwd: '/home/me/repo', path: 'notes.md' });
      expect(result.state.executionDevice).toMatchObject({
        deviceId: RUN_DEVICE.deviceId,
        requested: false,
      });
    });

    it('keeps the structured no-device answer when the run has no device', async () => {
      const result = await call({ path: '/tmp/a' }, baseContext({ activeDeviceId: undefined }));

      expect(result.error).toMatchObject({ code: 'NO_ACTIVE_DEVICE' });
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
    });
  });

  describe('an online device the run can use', () => {
    it('runs only this call there and reports it', async () => {
      const result = await call({ device: 'other-device', path: '/etc/hosts' });

      const { args, params } = dispatched();
      expect(params).toMatchObject({ deviceId: 'other-device', workspaceId: undefined });
      // The argument never reaches the device, and the run device's working
      // directory is not imposed on another machine.
      expect(args).toEqual({ path: '/etc/hosts' });
      expect(result.success).toBe(true);
      expect(result.state.executionDevice).toEqual({
        deviceId: 'other-device',
        hostname: 'other-host',
        name: 'Studio Mac',
        requested: true,
        scope: 'personal',
      });
    });

    it('leaves the next call without the argument on the run device', async () => {
      const proxy = localSystemRuntime.factory(baseContext()) as Record<
        string,
        (a: any) => Promise<any>
      >;
      await proxy[LocalSystemApiName.readFile]({ device: 'other-device', path: '/a' });
      await proxy[LocalSystemApiName.readFile]({ path: '/b' });

      expect(mocks.executeToolCall.mock.calls.map(([params]) => params.deviceId)).toEqual([
        'other-device',
        RUN_DEVICE.deviceId,
      ]);
    });

    it('matches a hostname or alias case-insensitively', async () => {
      await call({ device: 'studio mac', path: '/a' });
      expect(dispatched().params.deviceId).toBe('other-device');

      vi.clearAllMocks();
      mocks.executeToolCall.mockResolvedValue({ content: 'ok', success: true });
      mocks.getScopedOnlineDevices.mockResolvedValue([RUN_DEVICE, OTHER_ONLINE]);
      await call({ device: 'OTHER-HOST', path: '/a' });
      expect(dispatched().params.deviceId).toBe('other-device');
    });

    it('runs where the run already is when the argument names the run device', async () => {
      const result = await call({ device: RUN_DEVICE.deviceId, path: 'notes.md' });

      expect(mocks.getScopedOnlineDevices).not.toHaveBeenCalled();
      expect(dispatched().args).toEqual({ cwd: '/home/me/repo', path: 'notes.md' });
      expect(result.state.executionDevice).toMatchObject({
        deviceId: RUN_DEVICE.deviceId,
        requested: true,
      });
    });

    it('runs on the named device even when the run has no device yet', async () => {
      const result = await call(
        { device: 'other-device', path: '/a' },
        baseContext({ activeDeviceId: undefined }),
      );

      expect(result.success).toBe(true);
      expect(dispatched().params.deviceId).toBe('other-device');
    });

    it('addresses a workspace device through the workspace pool', async () => {
      mocks.getScopedOnlineDevices.mockResolvedValue([
        { ...OTHER_ONLINE, scope: 'workspace' as const },
      ]);

      const result = await call(
        { device: 'other-device', path: '/a' },
        baseContext({ activeDeviceScope: 'workspace', workspaceId: 'ws-1' }),
      );

      expect(mocks.getScopedOnlineDevices).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'ws-1',
      );
      expect(dispatched().params).toMatchObject({ deviceId: 'other-device', workspaceId: 'ws-1' });
      expect(result.state.executionDevice.scope).toBe('workspace');
    });

    it('sends follow-up shell calls to the named device', async () => {
      await call({ device: 'other-device', shell_id: 'sh-1' }, baseContext(), 'getCommandOutput');

      expect(dispatched()).toMatchObject({
        args: { shell_id: 'sh-1' },
        params: { deviceId: 'other-device' },
      });
    });
  });

  describe('an offline device', () => {
    it('fails without running the call anywhere', async () => {
      const result = await call({ device: 'sleeping-device', path: '/a' });

      expect(mocks.awaitManagedDeviceForToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'sleeping-device',
      );
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'DEVICE_OFFLINE',
        kind: 'stop',
        requestedDevice: 'sleeping-device',
      });
      expect(result.content).toContain('not run on it or anywhere else');
    });

    it('runs on a managed device that wakes up in time', async () => {
      mocks.awaitManagedDeviceForToolCall.mockResolvedValue('online');

      const result = await call({ device: 'sleeping-device', path: '/a' });

      expect(result.success).toBe(true);
      expect(dispatched().params.deviceId).toBe('sleeping-device');
    });

    it('tells the model to retry while a managed device is still starting', async () => {
      mocks.awaitManagedDeviceForToolCall.mockResolvedValue({
        content: 'starting',
        error: { code: 'DEVICE_WAKING', deviceId: 'sleeping-device', message: 'starting' },
        success: false,
      });

      const result = await call({ device: 'sleeping-device', path: '/a' });

      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.error).toMatchObject({ code: 'DEVICE_WAKING', kind: 'stop' });
    });
  });

  describe('a device the run cannot use', () => {
    it('fails for a device outside the run pool and lists the usable online ones', async () => {
      const result = await call({ device: 'someone-elses-device', path: '/a' });

      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatchObject({
        code: 'DEVICE_NOT_ACCESSIBLE',
        requestedDevice: 'someone-elses-device',
      });
      expect(result.content).toContain('"Studio Mac" (other-device)');
      expect(result.content).not.toContain('sleeping-device');
    });

    it('fails when a name matches several devices', async () => {
      mocks.getScopedOnlineDevices.mockResolvedValue([
        device('mac-a', 'macbook', true),
        device('mac-b', 'MacBook', true),
      ]);

      const result = await call({ device: 'macbook', path: '/a' });

      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.error).toMatchObject({ code: 'DEVICE_AMBIGUOUS' });
      expect(result.content).toContain('mac-a');
      expect(result.content).toContain('mac-b');
    });

    it.each([
      ['the workspace fixed the agent device', { deviceSelectionFixed: true }],
      ['the plan is not device-capable', { deviceCapable: false }],
      ['the run is a share visitor', { agentShareVisitor: {} as any }],
    ])('refuses another device when %s', async (_label, overrides) => {
      const result = await call({ device: 'other-device', path: '/a' }, baseContext(overrides));

      expect(mocks.getScopedOnlineDevices).not.toHaveBeenCalled();
      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.error).toMatchObject({ code: 'DEVICE_SELECTION_UNAVAILABLE' });
    });

    it('rejects a non-string device instead of using the run device', async () => {
      const result = await call({ device: 42, path: '/a' });

      expect(mocks.executeToolCall).not.toHaveBeenCalled();
      expect(result.error).toMatchObject({ code: 'DEVICE_NOT_ACCESSIBLE' });
    });
  });
});
