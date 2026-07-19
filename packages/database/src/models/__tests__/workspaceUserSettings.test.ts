// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaces, workspaceUserSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceUserSettingsModel } from '../workspaceUserSettings';

const serverDB: LobeChatDatabase = await getTestDB();

const workspaceId = 'ws-user-settings-test';
const userA = 'ws-us-user-a';
const userB = 'ws-us-user-b';

const cleanup = async () => {
  await serverDB.delete(workspaceUserSettings);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userA }, { id: userB }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userA, slug: 'ws' });
});

afterEach(cleanup);

describe('WorkspaceUserSettingsModel', () => {
  it('returns undefined / empty defaults when no row exists yet', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    expect(await model.get()).toBeUndefined();
    expect(await model.getPreference()).toEqual({});
  });

  it('lazily creates the row on first updatePreference (UPSERT insert branch)', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentDeviceOverrides: {
        agentX: { boundDeviceId: 'device-1', executionTarget: 'device' },
      },
    });

    const row = await model.get();
    expect(row).toBeDefined();
    expect(row?.preference).toEqual({
      agentDeviceOverrides: {
        agentX: { boundDeviceId: 'device-1', executionTarget: 'device' },
      },
    });
  });

  it('merges subsequent patches into the same row instead of replacing (UPSERT update branch)', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentDeviceOverrides: { agentX: { executionTarget: 'sandbox' } },
    });
    // Patch adds a second agent — the first agent's override must survive.
    await model.updatePreference({
      agentDeviceOverrides: {
        agentX: { executionTarget: 'sandbox' },
        agentY: { boundDeviceId: 'device-Y', executionTarget: 'device' },
      },
    });

    const preference = await model.getPreference();
    expect(preference.agentDeviceOverrides).toEqual({
      agentX: { executionTarget: 'sandbox' },
      agentY: { boundDeviceId: 'device-Y', executionTarget: 'device' },
    });
  });

  it('deep-merges agentDeviceOverrides so a single-agent patch never drops other agents', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentDeviceOverrides: { agentX: { executionTarget: 'sandbox' } },
    });

    // A client with a stale/empty local copy patches ONLY agentY — agentX's
    // saved choice must survive the write.
    await model.updatePreference({
      agentDeviceOverrides: {
        agentY: { boundDeviceId: 'device-Y', executionTarget: 'device' },
      },
    });

    const preference = await model.getPreference();
    expect(preference.agentDeviceOverrides).toEqual({
      agentX: { executionTarget: 'sandbox' },
      agentY: { boundDeviceId: 'device-Y', executionTarget: 'device' },
    });
  });

  it("isolates users' rows so one caller can never observe another's preference", async () => {
    const modelA = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    const modelB = new WorkspaceUserSettingsModel(serverDB, userB, workspaceId);

    await modelA.updatePreference({
      agentDeviceOverrides: { shared: { boundDeviceId: 'A-device', executionTarget: 'device' } },
    });
    await modelB.updatePreference({
      agentDeviceOverrides: { shared: { boundDeviceId: 'B-device', executionTarget: 'device' } },
    });

    const [prefA, prefB] = await Promise.all([modelA.getPreference(), modelB.getPreference()]);
    expect(prefA.agentDeviceOverrides?.shared?.boundDeviceId).toBe('A-device');
    expect(prefB.agentDeviceOverrides?.shared?.boundDeviceId).toBe('B-device');
  });

  it('cascades on workspace delete — FK removes every row for that workspace', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentDeviceOverrides: { a: { executionTarget: 'sandbox' } },
    });
    expect(await model.get()).toBeDefined();

    await serverDB.delete(workspaces);
    expect(await model.get()).toBeUndefined();
  });

  it('cascades on user delete — FK removes every row for that user', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentDeviceOverrides: { a: { executionTarget: 'sandbox' } },
    });
    expect(await model.get()).toBeDefined();

    await serverDB.delete(users);
    expect(await model.get()).toBeUndefined();
  });
});
