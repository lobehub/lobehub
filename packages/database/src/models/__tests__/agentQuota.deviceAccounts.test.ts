// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentDeviceAccountBindingModel,
  AgentProviderAccountLoginModel,
  AgentProviderAccountModel,
} from '../agentQuota';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-device-user';
const teammateId = 'agent-quota-device-teammate';
const workspaceId = 'agent-quota-device-workspace';
const agentId = 'agent-quota-device-agent';

let deviceA: string;
let deviceB: string;
let accountId: string;
let otherAccountId: string;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: teammateId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Device accounts',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(agents).values({ id: agentId, userId });
  const rows = await serverDB
    .insert(devices)
    .values([
      { deviceId: 'gateway-a', identitySource: 'stable', userId },
      { deviceId: 'gateway-b', identitySource: 'stable', userId },
    ])
    .returning();
  [deviceA, deviceB] = rows.map((row) => row.id);
  const accounts = new AgentProviderAccountModel(serverDB, userId);
  accountId = (await accounts.upsertByIdentity('claude-code', { externalAccountId: 'ext-1' })).id;
  otherAccountId = (await accounts.upsertByIdentity('claude-code', { externalAccountId: 'ext-2' }))
    .id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentProviderAccountLoginModel', () => {
  it('records one login per account and device, refreshing it on every report', async () => {
    const logins = new AgentProviderAccountLoginModel(serverDB, userId);

    const first = await logins.record(accountId, deviceA);
    const again = await logins.record(accountId, deviceA);
    await logins.record(accountId, deviceB);

    expect(again.id).toBe(first.id);
    expect(again.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
    expect((await logins.listByDevice(deviceA)).map((l) => l.accountId)).toEqual([accountId]);
    expect((await logins.listByAccount(accountId)).map((l) => l.deviceId).sort()).toEqual(
      [deviceA, deviceB].sort(),
    );
  });

  it('removes only the named logins on one device', async () => {
    const logins = new AgentProviderAccountLoginModel(serverDB, userId);
    await logins.record(accountId, deviceA);
    await logins.record(otherAccountId, deviceA);
    await logins.record(accountId, deviceB);

    await logins.removeOnDevice(deviceA, []);
    await logins.removeOnDevice(deviceA, [accountId]);

    expect((await logins.listByDevice(deviceA)).map((l) => l.accountId)).toEqual([otherAccountId]);
    expect(await logins.listByDevice(deviceB)).toHaveLength(1);
  });

  it('keeps personal and workspace logins apart', async () => {
    await new AgentProviderAccountLoginModel(serverDB, userId).record(accountId, deviceA);

    expect(
      await new AgentProviderAccountLoginModel(serverDB, userId, workspaceId).listByDevice(deviceA),
    ).toEqual([]);
    expect(
      await new AgentProviderAccountLoginModel(serverDB, teammateId).listByDevice(deviceA),
    ).toEqual([]);
  });
});

describe('AgentDeviceAccountBindingModel', () => {
  it('keeps one choice per agent and device, replaced by the next one', async () => {
    const logins = new AgentProviderAccountLoginModel(serverDB, userId);
    const choices = new AgentDeviceAccountBindingModel(serverDB, userId);
    await logins.record(accountId, deviceA);
    await logins.record(otherAccountId, deviceA);
    await logins.record(accountId, deviceB);

    await choices.set(agentId, deviceA, accountId);
    await choices.set(agentId, deviceA, otherAccountId);
    await choices.set(agentId, deviceB, accountId);

    expect((await choices.find(agentId, deviceA))?.accountId).toBe(otherAccountId);
    expect(await choices.listByAgent(agentId)).toHaveLength(2);

    await choices.clear(agentId, deviceA);
    expect(await choices.find(agentId, deviceA)).toBeNull();
  });

  it('rejects a choice the device holds no login for, and drops it with the login', async () => {
    const logins = new AgentProviderAccountLoginModel(serverDB, userId);
    const choices = new AgentDeviceAccountBindingModel(serverDB, userId);

    await expect(choices.set(agentId, deviceA, accountId)).rejects.toThrow();

    await logins.record(accountId, deviceA);
    await choices.set(agentId, deviceA, accountId);
    await logins.removeOnDevice(deviceA, [accountId]);

    expect(await choices.find(agentId, deviceA)).toBeNull();
  });
});
