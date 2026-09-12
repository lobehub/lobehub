import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, expect, it, vi } from 'vitest';

import { DevicePoolAccessService } from './poolAccess';

const mocks = vi.hoisted(() => ({ preference: vi.fn(), authorizedDevices: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserPreference: mocks.preference };
  }),
}));
vi.mock('@/database/models/devicePool', () => ({
  DevicePoolModel: vi.fn().mockImplementation(function () {
    return { authorizedDevices: mocks.authorizedDevices };
  }),
}));

const db = {} as LobeChatDatabase;
const access = new DevicePoolAccessService(db, 'owner', 'workspace');
const input = { agentId: 'agent', bot: false, shareVisitor: false, task: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preference.mockResolvedValue(undefined);
  mocks.authorizedDevices.mockResolvedValue([]);
});

/** @example Existing users do not enter pool authorization or query pool tables. */
it('defaults to disabled and bypasses pool provenance and grants', async () => {
  expect(await access.isEnabled()).toBe(false);
  expect(await access.createContext(input)).toBeUndefined();
  expect(await access.loadContext('old-operation')).toBeUndefined();
  expect(
    await access.authorizedDevices({ agentId: 'agent', blocked: false, trigger: 'chat' }),
  ).toEqual([]);
  expect(mocks.authorizedDevices).not.toHaveBeenCalled();
});

/** @example Opt-in enables provenance and live grants; switching off takes effect on the next check. */
it('rechecks the persisted opt-in without retaining positive grants', async () => {
  mocks.preference.mockResolvedValue({ lab: { enableDevicePools: true } });
  const context = await access.createContext(input);
  expect(context).toMatchObject({
    actorUserId: 'owner',
    workspaceId: 'workspace',
    trigger: 'chat',
  });
  await access.authorizedDevices(context!);
  expect(mocks.authorizedDevices).toHaveBeenCalledOnce();
  mocks.preference.mockResolvedValue({ lab: { enableDevicePools: false } });
  expect(await access.createContext(input)).toBeUndefined();
  expect(await access.authorizedDevices(context!)).toEqual([]);
  expect(mocks.authorizedDevices).toHaveBeenCalledOnce();
});
