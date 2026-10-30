// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentDeviceAccountBindings,
  agentProviderAccountLogins,
  agentProviderAccounts,
  agents,
  devices,
  users,
} from '..';

const serverDB = await getTestDB();
const userId = 'agent-account-logins-user';
const teammateId = 'agent-account-logins-teammate';

const createDevice = async (owner: string, deviceId: string) => {
  const [device] = await serverDB
    .insert(devices)
    .values({ deviceId, identitySource: 'machine-id', userId: owner })
    .returning();
  return device;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: teammateId }]);
  await serverDB.insert(agents).values({ id: 'agent-cc', userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, teammateId));
});

describe('subscription account logins and device bindings', () => {
  it('keeps one account row for a login held on several members’ devices', async () => {
    const [account] = await serverDB
      .insert(agentProviderAccounts)
      .values({ externalAccountId: 'acct-team-max', provider: 'claude-code', userId })
      .returning();
    const laptop = await createDevice(userId, 'laptop');
    const teammateLaptop = await createDevice(teammateId, 'teammate-laptop');

    await serverDB.insert(agentProviderAccountLogins).values([
      { accountId: account.id, deviceId: laptop.id, userId },
      { accountId: account.id, deviceId: teammateLaptop.id, userId: teammateId },
    ]);
    await expect(
      serverDB
        .insert(agentProviderAccountLogins)
        .values({ accountId: account.id, deviceId: laptop.id, userId: teammateId }),
    ).rejects.toThrow();

    const logins = await serverDB
      .select()
      .from(agentProviderAccountLogins)
      .where(eq(agentProviderAccountLogins.accountId, account.id));
    expect(logins.map((login) => login.userId).sort()).toEqual([teammateId, userId].sort());
  });

  it('binds an agent only to an account signed in on that device, and drops it on sign-out', async () => {
    const [account] = await serverDB
      .insert(agentProviderAccounts)
      .values({ externalAccountId: 'acct-personal', provider: 'claude-code', userId })
      .returning();
    const laptop = await createDevice(userId, 'laptop-2');
    const desktop = await createDevice(userId, 'desktop-2');
    const [login] = await serverDB
      .insert(agentProviderAccountLogins)
      .values({ accountId: account.id, deviceId: laptop.id, userId })
      .returning();

    // not signed in on the desktop: the binding is rejected
    await expect(
      serverDB
        .insert(agentDeviceAccountBindings)
        .values({ accountId: account.id, agentId: 'agent-cc', deviceId: desktop.id, userId }),
    ).rejects.toThrow();

    await serverDB
      .insert(agentDeviceAccountBindings)
      .values({ accountId: account.id, agentId: 'agent-cc', deviceId: laptop.id, userId });

    await serverDB
      .delete(agentProviderAccountLogins)
      .where(eq(agentProviderAccountLogins.id, login.id));
    const bindings = await serverDB
      .select()
      .from(agentDeviceAccountBindings)
      .where(eq(agentDeviceAccountBindings.agentId, 'agent-cc'));
    expect(bindings).toHaveLength(0);
  });
});
