// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRunFacts } from '../runFacts';

const { getUserSettings, queryDeviceSystemInfo } = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  queryDeviceSystemInfo: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    constructor(
      _db: unknown,
      readonly userId: string,
    ) {}
    getUserSettings = () => getUserSettings(this.userId);
  },
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { queryDeviceSystemInfo },
}));

const facts = () => createRunFacts({ db: {} as never, userId: 'owner-1', workspaceId: 'ws-1' });

beforeEach(() => {
  vi.clearAllMocks();
  getUserSettings.mockResolvedValue({ market: { accessToken: 'tok' } });
  queryDeviceSystemInfo.mockResolvedValue({ hostname: 'PC', supportedTools: [] });
});

describe('createRunFacts', () => {
  it('asks a routed device for its system info once per turn', async () => {
    const runFacts = facts();

    const [a, b] = await Promise.all([
      runFacts.deviceSystemInfo('dev-1'),
      runFacts.deviceSystemInfo('dev-1'),
    ]);
    await runFacts.deviceSystemInfo('dev-1');

    expect(queryDeviceSystemInfo).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // A personal device must not receive the workspace id.
    expect(queryDeviceSystemInfo).toHaveBeenCalledWith('owner-1', 'dev-1', undefined);
  });

  it('keeps the workspace and personal scopes of the same device apart', async () => {
    const runFacts = facts();

    await runFacts.deviceSystemInfo('dev-1', 'workspace');
    await runFacts.deviceSystemInfo('dev-1', 'personal');

    expect(queryDeviceSystemInfo).toHaveBeenCalledTimes(2);
    expect(queryDeviceSystemInfo).toHaveBeenNthCalledWith(1, 'owner-1', 'dev-1', 'ws-1');
    expect(queryDeviceSystemInfo).toHaveBeenNthCalledWith(2, 'owner-1', 'dev-1', undefined);
  });

  it('remembers an unreachable device rather than asking again', async () => {
    queryDeviceSystemInfo.mockResolvedValue(undefined);
    const runFacts = facts();

    await expect(runFacts.deviceSystemInfo('offline')).resolves.toBeUndefined();
    await expect(runFacts.deviceSystemInfo('offline')).resolves.toBeUndefined();
    expect(queryDeviceSystemInfo).toHaveBeenCalledTimes(1);
  });

  it('reads the settings row once per user, and a visitor separately', async () => {
    const runFacts = facts();

    await runFacts.userSettings();
    await runFacts.userSettings();
    await runFacts.userSettings('visitor-1');

    expect(getUserSettings).toHaveBeenCalledTimes(2);
    expect(getUserSettings).toHaveBeenNthCalledWith(1, 'owner-1');
    expect(getUserSettings).toHaveBeenNthCalledWith(2, 'visitor-1');
  });

  it('keeps a failed settings read a failure, and does not retry it', async () => {
    getUserSettings.mockRejectedValue(new Error('database unavailable'));
    const runFacts = facts();

    // Swallowing this would read as "nothing is set", which `execAgent` turns
    // into memory enabled — the opposite of the conservative default a failed
    // read must keep.
    await expect(runFacts.userSettings()).rejects.toThrow('database unavailable');
    await expect(runFacts.userSettings()).rejects.toThrow('database unavailable');
    expect(getUserSettings).toHaveBeenCalledTimes(1);
  });
});
