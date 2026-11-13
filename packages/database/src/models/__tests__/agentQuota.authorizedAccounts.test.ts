// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentAccountBindings, agents, devices, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentAccountBindingModel,
  AgentDeviceAccountBindingModel,
  AgentProviderAccountLoginModel,
  AgentProviderAccountModel,
} from '../agentQuota';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-authz-user';
const agentA = 'agent-quota-authz-a';
const agentB = 'agent-quota-authz-b';

let accounts: AgentProviderAccountModel;
let bindings: AgentAccountBindingModel;
let deviceBindings: AgentDeviceAccountBindingModel;
let logins: AgentProviderAccountLoginModel;
let ids: { x: string; y: string; z: string };

const roles = async (agentId: string) =>
  Object.fromEntries(
    (await bindings.listByAgent(agentId)).map((b) => [b.accountId, `${b.role}:${b.enabled}`]),
  );

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values([
    { id: agentA, userId },
    { id: agentB, userId },
  ]);
  accounts = new AgentProviderAccountModel(serverDB, userId);
  bindings = new AgentAccountBindingModel(serverDB, userId);
  deviceBindings = new AgentDeviceAccountBindingModel(serverDB, userId);
  logins = new AgentProviderAccountLoginModel(serverDB, userId);

  const make = (externalAccountId: string) =>
    accounts.create({ externalAccountId, provider: 'claude-code' });
  const [x, y, z] = await Promise.all([make('ext-x'), make('ext-y'), make('ext-z')]);
  ids = { x: x.id, y: y.id, z: z.id };
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentAccountBindingModel.setAuthorizedAccounts', () => {
  it('creates pool bindings for a fresh agent and drops the ones left out', async () => {
    const scope = [ids.x, ids.y, ids.z];
    await bindings.setAuthorizedAccounts(agentA, [ids.x, ids.y], scope);
    expect(await roles(agentA)).toEqual({ [ids.x]: 'pool:true', [ids.y]: 'pool:true' });

    await bindings.setAuthorizedAccounts(agentA, [ids.y, ids.z], scope);
    expect(await roles(agentA)).toEqual({ [ids.y]: 'pool:true', [ids.z]: 'pool:true' });
  });

  it('keeps a pin and re-authorizes a disabled or switched-off binding', async () => {
    await bindings.upsert({ accountId: ids.x, agentId: agentA, role: 'pinned' });
    await bindings.upsert({ accountId: ids.y, agentId: agentA, role: 'disabled' });
    await bindings.upsert({ accountId: ids.z, agentId: agentA, enabled: false, role: 'pool' });

    await bindings.setAuthorizedAccounts(agentA, [ids.x, ids.y, ids.z], [ids.x, ids.y, ids.z]);

    expect(await roles(agentA)).toEqual({
      [ids.x]: 'pinned:true',
      [ids.y]: 'pool:true',
      [ids.z]: 'pool:true',
    });
  });

  it('drops a pinned account left out of the set (agent returns to Auto)', async () => {
    await bindings.upsert({ accountId: ids.x, agentId: agentA, role: 'pinned' });
    await bindings.setAuthorizedAccounts(agentA, [ids.y], [ids.x, ids.y]);
    expect(await roles(agentA)).toEqual({ [ids.y]: 'pool:true' });
  });

  it('leaves bindings outside the scope alone (another provider)', async () => {
    await bindings.upsert({ accountId: ids.z, agentId: agentA, role: 'pool' });
    await bindings.setAuthorizedAccounts(agentA, [ids.x], [ids.x, ids.y]);
    expect(await roles(agentA)).toEqual({ [ids.x]: 'pool:true', [ids.z]: 'pool:true' });
  });

  it('is not exclusive: two agents authorize the same account independently', async () => {
    const scope = [ids.x, ids.y, ids.z];
    await bindings.setAuthorizedAccounts(agentA, [ids.x, ids.y], scope);
    await bindings.setAuthorizedAccounts(agentB, [ids.x], scope);
    // B shrinking its set does not touch A's binding of the shared account
    await bindings.setAuthorizedAccounts(agentB, [], scope);

    expect(await roles(agentA)).toEqual({ [ids.x]: 'pool:true', [ids.y]: 'pool:true' });
    expect(await roles(agentB)).toEqual({});
  });

  it('preserves the rotation stamp of a binding that stays authorized', async () => {
    await bindings.setAuthorizedAccounts(agentA, [ids.x], [ids.x]);
    const at = new Date('2026-11-01T00:00:00Z');
    await bindings.markSelected(agentA, ids.x, at);
    await bindings.setAuthorizedAccounts(agentA, [ids.x], [ids.x]);

    const [row] = await bindings.listByAgent(agentA);
    expect(row.lastSelectedAt?.toISOString()).toBe(at.toISOString());
  });
});

describe('AgentAccountBindingModel.markSelected', () => {
  it("stamps only this agent's binding of the account", async () => {
    await bindings.setAuthorizedAccounts(agentA, [ids.x], [ids.x]);
    await bindings.setAuthorizedAccounts(agentB, [ids.x], [ids.x]);
    const at = new Date('2026-11-02T00:00:00Z');

    await bindings.markSelected(agentA, ids.x, at);

    const rows = await serverDB
      .select({ agentId: agentAccountBindings.agentId, at: agentAccountBindings.lastSelectedAt })
      .from(agentAccountBindings)
      .where(eq(agentAccountBindings.accountId, ids.x));
    expect(Object.fromEntries(rows.map((r) => [r.agentId, r.at?.toISOString() ?? null]))).toEqual({
      [agentA]: at.toISOString(),
      [agentB]: null,
    });
  });
});

describe('AgentAccountBindingModel.lockSelection', () => {
  it('serializes selections of one agent inside transactions', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((resolve) => (firstLocked = resolve));

    const first = serverDB.transaction(async (tx) => {
      await new AgentAccountBindingModel(tx as any, userId).lockSelection(agentA);
      order.push('first-locked');
      firstLocked();
      await firstHolds;
      order.push('first-done');
    });
    await firstHasLock;
    const second = serverDB.transaction(async (tx) => {
      await new AgentAccountBindingModel(tx as any, userId).lockSelection(agentA);
      order.push('second-locked');
    });
    // give the second transaction time to block on the lock
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
  });
});

describe('AgentDeviceAccountBindingModel.clearAccounts', () => {
  it("drops only the agent's device choices of the given accounts", async () => {
    const [device] = await serverDB
      .insert(devices)
      .values({ deviceId: 'authz-gateway', identitySource: 'stable', userId })
      .returning();
    await logins.record(ids.x, device.id);
    await logins.record(ids.y, device.id);
    await deviceBindings.set(agentA, device.id, ids.x);
    await deviceBindings.set(agentB, device.id, ids.y);

    await deviceBindings.clearAccounts(agentA, [ids.x, ids.y]);
    await deviceBindings.clearAccounts(agentA, []);

    expect(await deviceBindings.find(agentA, device.id)).toBeNull();
    expect((await deviceBindings.find(agentB, device.id))?.accountId).toBe(ids.y);
  });
});
