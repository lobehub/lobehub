// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AgentAccountBindingModel,
  AgentDeviceAccountBindingModel,
  AgentProviderAccountModel,
} from '@/database/models/agentQuota';
import { agents, devices, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { QuotaBindingRole } from '@/database/types/agentQuota';

import { AccountNotSignedInOnDeviceError, AgentQuotaService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-device-user';
const agentId = 'agent-dev';

let service: AgentQuotaService;
let bindings: AgentAccountBindingModel;
let deviceBindings: AgentDeviceAccountBindingModel;
let deviceA: string;
let deviceB: string;

const addDevice = async (gatewayId: string) => {
  const [row] = await serverDB
    .insert(devices)
    .values({ deviceId: gatewayId, identitySource: 'stable', userId })
    .returning();
  return row.id;
};

/** An account signed in on `deviceId` (a sample ingested from there). */
const signedIn = (externalAccountId: string, deviceId?: string) =>
  service.ingestSnapshot({
    deviceId,
    identity: { email: `${externalAccountId}@example.com`, externalAccountId },
    provider: 'claude-code',
    readings: [],
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, slug: agentId, title: 'Dev', userId });
  service = new AgentQuotaService(serverDB, userId);
  bindings = new AgentAccountBindingModel(serverDB, userId);
  deviceBindings = new AgentDeviceAccountBindingModel(serverDB, userId);
  deviceA = await addDevice('gateway-a');
  deviceB = await addDevice('gateway-b');
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentQuotaService per-device account choice', () => {
  it('resolves a gateway device id to its row', async () => {
    expect(await service.resolveDeviceRowId('gateway-a')).toBe(deviceA);
    expect(await service.resolveDeviceRowId('unknown')).toBeUndefined();
    expect(await service.resolveDeviceRowId(undefined)).toBeUndefined();
  });

  it('routes each device to its own pick, and a device without one balances', async () => {
    const onA = await signedIn('acc-a', deviceA);
    const onB = await signedIn('acc-b', deviceB);
    for (const account of [onA, onB])
      await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });

    await service.setDeviceAccount(agentId, deviceA, onA.id);

    expect(await service.selectForAgent(agentId, { deviceId: deviceA })).toMatchObject({
      accountId: onA.id,
      pinScope: 'device',
      reason: 'pinned',
    });
    expect(
      await service.selectForAgent(agentId, {
        deviceId: deviceB,
        runnableExternalAccountIds: ['acc-b'],
      }),
    ).toMatchObject({ accountId: onB.id, reason: 'balanced' });
    expect(await service.getDeviceAccount(agentId, deviceA)).toBe(onA.id);
    expect(await service.getDeviceAccount(agentId, deviceB)).toBeNull();
  });

  // Regression: the pin was agent-wide, so an account picked on device A made
  // the agent fail on device B, where that account was never signed in.
  it('skips an agent-wide pin the caller cannot run and balances instead', async () => {
    const onA = await signedIn('acc-a', deviceA);
    const onB = await signedIn('acc-b', deviceB);
    await bindings.upsert({ accountId: onA.id, agentId, role: QuotaBindingRole.pinned });
    await bindings.upsert({ accountId: onB.id, agentId, role: QuotaBindingRole.pool });

    expect(
      await service.selectForAgent(agentId, {
        deviceId: deviceB,
        runnableExternalAccountIds: ['acc-b'],
      }),
    ).toMatchObject({ accountId: onB.id, reason: 'balanced' });
    // Where it can run, the old pin still holds.
    expect(
      await service.selectForAgent(agentId, {
        deviceId: deviceA,
        runnableExternalAccountIds: ['acc-a'],
      }),
    ).toMatchObject({ accountId: onA.id, pinScope: 'agent', reason: 'pinned' });
  });

  it('hands a legacy pin to the devices that hold its login on the first per-device write', async () => {
    const shared = await signedIn('acc-shared', deviceA);
    const onB = await signedIn('acc-b', deviceB);
    await bindings.upsert({ accountId: shared.id, agentId, role: QuotaBindingRole.pinned });
    await bindings.upsert({ accountId: onB.id, agentId, role: QuotaBindingRole.pool });

    // Choosing Auto on device B must not move device A off its pin.
    await service.setDeviceAccount(agentId, deviceB, null);

    expect(await service.getDeviceAccount(agentId, deviceA)).toBe(shared.id);
    expect(await service.getDeviceAccount(agentId, deviceB)).toBeNull();
    const roles = (await bindings.listByAgent(agentId)).map((b) => b.role);
    expect(roles).not.toContain(QuotaBindingRole.pinned);
  });

  it('refuses a pick for an account the device holds no login for', async () => {
    const onA = await signedIn('acc-a', deviceA);
    await bindings.upsert({ accountId: onA.id, agentId, role: QuotaBindingRole.pool });

    await expect(service.setDeviceAccount(agentId, deviceB, onA.id)).rejects.toBeInstanceOf(
      AccountNotSignedInOnDeviceError,
    );
  });

  it('leaves a legacy pin and every device untouched when the pick is refused', async () => {
    const shared = await signedIn('acc-shared', deviceA);
    const onlyA = await signedIn('acc-only-a', deviceA);
    await bindings.upsert({ accountId: shared.id, agentId, role: QuotaBindingRole.pinned });
    await bindings.upsert({ accountId: onlyA.id, agentId, role: QuotaBindingRole.pool });

    // Device B holds no login for it: the choice is refused...
    await expect(service.setDeviceAccount(agentId, deviceB, onlyA.id)).rejects.toBeInstanceOf(
      AccountNotSignedInOnDeviceError,
    );

    // ...and the legacy pin was neither handed out nor demoted.
    expect(await deviceBindings.listByAgent(agentId)).toEqual([]);
    const pinned = (await bindings.listByAgent(agentId)).find(
      (b) => b.role === QuotaBindingRole.pinned,
    );
    expect(pinned?.accountId).toBe(shared.id);
  });

  it('ignores a pick whose account left the rotation', async () => {
    const onA = await signedIn('acc-a', deviceA);
    const other = await signedIn('acc-other', deviceA);
    await bindings.upsert({ accountId: onA.id, agentId, role: QuotaBindingRole.pool });
    await bindings.upsert({ accountId: other.id, agentId, role: QuotaBindingRole.pool });
    await service.setDeviceAccount(agentId, deviceA, onA.id);

    await bindings.upsert({ accountId: onA.id, agentId, role: QuotaBindingRole.disabled });

    expect(await service.selectForAgent(agentId, { deviceId: deviceA })).toMatchObject({
      accountId: other.id,
      reason: 'balanced',
    });
  });

  it('forgets logins a device no longer reports, and the picks made on them', async () => {
    const kept = await signedIn('acc-kept', deviceA);
    const gone = await signedIn('acc-gone', deviceA);
    await bindings.upsert({ accountId: gone.id, agentId, role: QuotaBindingRole.pool });
    await service.setDeviceAccount(agentId, deviceA, gone.id);

    await service.syncDeviceLogins(deviceA, 'claude-code', ['acc-kept', 'acc-unknown']);

    expect(await service.getDeviceAccount(agentId, deviceA)).toBeNull();
    expect(await deviceBindings.listByAgent(agentId)).toEqual([]);
    // The kept login is still there, so it can be picked.
    await bindings.upsert({ accountId: kept.id, agentId, role: QuotaBindingRole.pool });
    await expect(service.setDeviceAccount(agentId, deviceA, kept.id)).resolves.toBeUndefined();
  });

  it('records a login when a device syncs one ingested without a device', async () => {
    const account = await signedIn('acc-local');
    await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });

    await expect(service.setDeviceAccount(agentId, deviceA, account.id)).rejects.toBeInstanceOf(
      AccountNotSignedInOnDeviceError,
    );
    await service.syncDeviceLogins(deviceA, 'claude-code', ['acc-local']);
    await service.setDeviceAccount(agentId, deviceA, account.id);

    expect(await service.getDeviceAccount(agentId, deviceA)).toBe(account.id);
  });
});

describe('AgentQuotaService.planDeviceRouting per device', () => {
  it("sends the device's own pick as the pin", async () => {
    const onA = await signedIn('acc-a', deviceA);
    const onB = await signedIn('acc-b', deviceB);
    for (const account of [onA, onB])
      await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });
    await service.setDeviceAccount(agentId, deviceB, onB.id);

    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceB, provider: 'claude-code' }),
    ).toEqual({
      candidates: [{ externalAccountId: 'acc-b', name: 'acc-b@example.com' }],
      mode: 'pinned',
    });
  });

  // Regression: a device-bound run used the agent-wide pin made on another
  // machine, so the device refused to start it.
  it('turns an agent-wide pin into the first Auto candidate where its login is unknown', async () => {
    const onA = await signedIn('acc-a', deviceA);
    const onB = await signedIn('acc-b', deviceB);
    await bindings.upsert({ accountId: onA.id, agentId, role: QuotaBindingRole.pinned });
    await bindings.upsert({ accountId: onB.id, agentId, role: QuotaBindingRole.pool });

    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceB, provider: 'claude-code' }),
    ).toEqual({
      candidates: [
        { externalAccountId: 'acc-a', name: 'acc-a@example.com' },
        { externalAccountId: 'acc-b', name: 'acc-b@example.com' },
      ],
      mode: 'balanced',
    });
    // On the device that holds its login it stays a strict pin.
    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceA, provider: 'claude-code' }),
    ).toEqual({
      candidates: [{ externalAccountId: 'acc-a', name: 'acc-a@example.com' }],
      mode: 'pinned',
    });
  });
});

describe('AgentQuotaService.resolveAgentAvailability', () => {
  const HOUR = 3_600_000;
  const now = Date.now();
  const resetsAt = now + 2 * HOUR;

  /** An account signed in on `deviceId` whose 5-hour window is at `utilization`. */
  const withSession = (externalAccountId: string, deviceId: string, utilization: number) =>
    service.ingestSnapshot({
      deviceId,
      identity: { email: `${externalAccountId}@example.com`, externalAccountId },
      provider: 'claude-code',
      readings: [
        { capturedAt: now - HOUR, limitType: 'session', resetsAt, scopeKey: '', utilization },
      ],
    });

  // Regression: presence judged the whole pool, so an agent whose device pin
  // was spent read "idle" while every run on that device hit the limit.
  it('judges a device pin alone, even when the rest of the pool has headroom', async () => {
    const spent = await withSession('acc-spent', deviceA, 100);
    const free = await withSession('acc-free', deviceA, 0);
    for (const account of [spent, free])
      await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });
    await service.setDeviceAccount(agentId, deviceA, spent.id);

    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual({
      accountIds: [spent.id],
      mode: 'pinned',
      resetsAt,
      status: 'exhausted',
    });
    // The dispatcher routes the run to that same spent account.
    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceA, now, provider: 'claude-code' }),
    ).toMatchObject({ candidates: [{ externalAccountId: 'acc-spent' }], mode: 'pinned' });
    // Back on Auto, the free account takes the run.
    await service.setDeviceAccount(agentId, deviceA, null);
    expect(
      await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now }),
    ).toMatchObject({ mode: 'balanced', status: 'available' });
  });

  // Regression: Auto mode was narrowed to the logins recorded for the device.
  // That record is partial (a remote device only has the accounts sampled
  // there) and an emptied set read like one never reported, so the verdict
  // flipped while the dispatcher kept offering the same candidates.
  it('judges Auto mode on the candidates the dispatcher sends, whatever logins are recorded', async () => {
    const spent = await withSession('acc-spent', deviceA, 100);
    const free = await withSession('acc-free', deviceB, 0);
    for (const account of [spent, free])
      await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });
    const expected = {
      accountIds: [spent.id, free.id],
      mode: 'balanced',
      status: 'available',
    };

    // Only the spent account was ever sampled on device A.
    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual(
      expected,
    );
    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceA, now, provider: 'claude-code' }),
    ).toMatchObject({ candidates: [{ externalAccountId: 'acc-free' }], mode: 'balanced' });

    // Device A then reports it holds no login at all.
    await service.syncDeviceLogins(deviceA, 'claude-code', []);
    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual(
      expected,
    );
  });

  it('is exhausted in Auto mode once every candidate is spent, and says when one returns', async () => {
    const early = await withSession('acc-early', deviceA, 100);
    await bindings.upsert({ accountId: early.id, agentId, role: QuotaBindingRole.pool });

    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual({
      accountIds: [early.id],
      mode: 'balanced',
      resetsAt,
      status: 'exhausted',
    });
  });

  // Regression: an all-disabled Auto pool read "exhausted" with no reset, so
  // presence showed the agent off duty for good, while the dispatcher routes
  // nothing there and the device's default login runs.
  it('does not judge an Auto pool whose accounts are all disabled', async () => {
    const accounts = new AgentProviderAccountModel(serverDB, userId);
    const spent = await withSession('acc-spent', deviceA, 100);
    const free = await withSession('acc-free', deviceA, 0);
    for (const account of [spent, free]) {
      await bindings.upsert({ accountId: account.id, agentId, role: QuotaBindingRole.pool });
      await accounts.update(account.id, { enabled: false });
    }

    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceA, now, provider: 'claude-code' }),
    ).toBeNull();
    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual({
      accountIds: [],
      mode: 'balanced',
      status: 'untracked',
    });
  });

  it('still judges a device pin on a disabled account: the run is sent to it', async () => {
    const spent = await withSession('acc-spent', deviceA, 100);
    await bindings.upsert({ accountId: spent.id, agentId, role: QuotaBindingRole.pool });
    await service.setDeviceAccount(agentId, deviceA, spent.id);
    await new AgentProviderAccountModel(serverDB, userId).update(spent.id, { enabled: false });

    expect(
      await service.planDeviceRouting(agentId, { deviceId: deviceA, now, provider: 'claude-code' }),
    ).toMatchObject({ candidates: [{ externalAccountId: 'acc-spent' }], mode: 'pinned' });
    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual({
      accountIds: [spent.id],
      mode: 'pinned',
      resetsAt,
      status: 'exhausted',
    });
  });

  it('does not judge an agent without accounts', async () => {
    expect(await service.resolveAgentAvailability(agentId, { deviceId: deviceA, now })).toEqual({
      accountIds: [],
      status: 'untracked',
    });
  });
});
