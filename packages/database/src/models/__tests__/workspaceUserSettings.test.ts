// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, workspaceMembers, workspaces, workspaceUserSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { WorkspaceUserSettingsModel } from '../workspaceUserSettings';

const serverDB: LobeChatDatabase = await getTestDB();

const workspaceId = 'ws-user-settings-test';
const userA = 'ws-us-user-a';
const userB = 'ws-us-user-b';

const cleanup = async () => {
  await serverDB.delete(workspaceMembers);
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

  it('deep-merges agentModelOverrides so a single-agent patch never drops other agents', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      agentModelOverrides: {
        agentX: { model: 'model-x', provider: 'provider-x' },
      },
    });

    await model.updatePreference({
      agentModelOverrides: {
        agentY: { model: 'model-y', provider: 'provider-y' },
      },
    });

    const preference = await model.getPreference();
    expect(preference.agentModelOverrides).toEqual({
      agentX: { model: 'model-x', provider: 'provider-x' },
      agentY: { model: 'model-y', provider: 'provider-y' },
    });
  });

  it('deep-merges agentModeOverrides so a single-agent patch never drops other agents', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({ agentModeOverrides: { agentX: true } });

    await model.updatePreference({ agentModeOverrides: { agentY: false } });

    const preference = await model.getPreference();
    expect(preference.agentModeOverrides).toEqual({ agentX: true, agentY: false });
  });

  it('deep-merges sidebarAgentVisibilityOverrides across single-item patches', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({ sidebarAgentVisibilityOverrides: { agentX: true } });

    await model.updatePreference({ sidebarAgentVisibilityOverrides: { agentY: false } });

    const preference = await model.getPreference();
    expect(preference.sidebarAgentVisibilityOverrides).toEqual({ agentX: true, agentY: false });
  });

  it.each([
    ['sidebarGroupAssignments', 'folder-1'],
    ['sidebarPinnedOverrides', true],
  ] as const)(
    'keeps deep-merging the deprecated %s for clients from before the shared sidebar',
    async (key, value) => {
      // The fields are deprecated but still on the API, so a released client
      // can patch a single item. A top-level replace would let one such write
      // shred the rest of that user's map — the very data the deprecation
      // promises to leave intact for a rollback.
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
      await model.updatePreference({ [key]: { itemX: value } } as any);

      await model.updatePreference({ [key]: { itemY: value } } as any);

      const preference = await model.getPreference();
      expect((preference as any)[key]).toEqual({ itemX: value, itemY: value });
    },
  );

  it('replaces sidebarHiddenGroupIds wholesale — the caller always writes the full list', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({ sidebarHiddenGroupIds: ['folder-1', 'folder-2'] });

    // Un-hiding folder-1 sends the remaining list, not a delta.
    await model.updatePreference({ sidebarHiddenGroupIds: ['folder-2'] });

    const preference = await model.getPreference();
    expect(preference.sidebarHiddenGroupIds).toEqual(['folder-2']);
  });

  it('deep-merges notification so a single-switch patch never drops other toggles', async () => {
    const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    await model.updatePreference({
      notification: {
        email: { items: { workspace: { workspace_member_joined: false } } },
        inbox: { enabled: false },
      },
    });

    // Patch a single other leaf — the earlier email item toggle and the inbox
    // master switch must both survive the write.
    await model.updatePreference({
      notification: {
        email: { items: { workspace: { workspace_payment_failed: false } } },
      },
    });

    const preference = await model.getPreference();
    expect(preference.notification).toEqual({
      email: {
        items: {
          workspace: { workspace_member_joined: false, workspace_payment_failed: false },
        },
      },
      inbox: { enabled: false },
    });
  });

  it("isolates users' rows so one caller can never observe another's preference", async () => {
    const modelA = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
    const modelB = new WorkspaceUserSettingsModel(serverDB, userB, workspaceId);

    await modelA.updatePreference({
      agentDeviceOverrides: { shared: { boundDeviceId: 'A-device', executionTarget: 'device' } },
      agentModelOverrides: { shared: { model: 'A-model', provider: 'A-provider' } },
      agentModeOverrides: { shared: true },
    });
    await modelB.updatePreference({
      agentDeviceOverrides: { shared: { boundDeviceId: 'B-device', executionTarget: 'device' } },
      agentModelOverrides: { shared: { model: 'B-model', provider: 'B-provider' } },
      agentModeOverrides: { shared: false },
    });

    const [prefA, prefB] = await Promise.all([modelA.getPreference(), modelB.getPreference()]);
    expect(prefA.agentDeviceOverrides?.shared?.boundDeviceId).toBe('A-device');
    expect(prefB.agentDeviceOverrides?.shared?.boundDeviceId).toBe('B-device');
    expect(prefA.agentModelOverrides?.shared?.model).toBe('A-model');
    expect(prefB.agentModelOverrides?.shared?.model).toBe('B-model');
    expect(prefA.agentModeOverrides?.shared).toBe(true);
    expect(prefB.agentModeOverrides?.shared).toBe(false);
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

  describe('initializeSidebar', () => {
    it('adds the recommended Agents to a new member’s sidebar, unpinned', async () => {
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);

      const result = await model.initializeSidebar({ listIds: ['rec-1', 'rec-2'] });

      expect(result).toEqual({
        sidebarAgentVisibilityOverrides: { 'rec-1': true, 'rec-2': true },
        sidebarInitialized: true,
      });
      expect(await model.getPreference()).toEqual(result);
    });

    it('never overrides a sidebar choice the member already made', async () => {
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
      await model.updatePreference({ sidebarAgentVisibilityOverrides: { 'rec-1': false } });

      await model.initializeSidebar({ listIds: ['rec-1', 'rec-2'] });

      expect((await model.getPreference()).sidebarAgentVisibilityOverrides).toEqual({
        'rec-1': false,
        'rec-2': true,
      });
    });

    it('appends team pins after an existing member’s own pins, once', async () => {
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
      await model.updatePreference({
        sidebarHiddenGroupIds: ['g'],
        sidebarPinnedItemIds: ['mine', 'team-2'],
      });

      await model.initializeSidebar({ pinIds: ['team-1', 'team-2'] });
      // A later call — for example after admins change the list — is a no-op.
      await model.initializeSidebar({ listIds: ['rec-3'], pinIds: ['team-3'] });

      expect(await model.getPreference()).toEqual({
        sidebarHiddenGroupIds: ['g'],
        sidebarInitialized: true,
        sidebarPinnedItemIds: ['mine', 'team-2', 'team-1'],
      });
    });

    it('leaves the member not set up while there is nothing to add', async () => {
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);

      expect(await model.initializeSidebar({})).toEqual({});
      expect(await model.get()).toBeUndefined();
    });

    it('never loses the first setup to a preference write that read before it', async () => {
      const setup = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
      const write = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);
      // The setup commits right after the write has read the (still empty)
      // preference — the interleaving two concurrent first writes can take.
      // A write that reads under the row lock never gives the setup that
      // chance; the setup then simply runs after it.
      const read = write.getPreference;
      let setupRan = false;
      vi.spyOn(write, 'getPreference').mockImplementation(async () => {
        const stale = await read();
        await setup.initializeSidebar({ listIds: ['rec-1'] });
        setupRan = true;
        return stale;
      });

      await write.updatePreference({ sidebarPinnedItemIds: ['mine'] });
      if (!setupRan) await setup.initializeSidebar({ listIds: ['rec-1'] });

      expect(await setup.getPreference()).toEqual({
        sidebarAgentVisibilityOverrides: { 'rec-1': true },
        sidebarInitialized: true,
        sidebarPinnedItemIds: ['mine'],
      });
    });

    it('marks the member as set up when nothing can ever be added', async () => {
      const model = new WorkspaceUserSettingsModel(serverDB, userA, workspaceId);

      expect(await model.initializeSidebar({ final: true, pinIds: [] })).toEqual({
        sidebarInitialized: true,
      });
      expect(await model.getPreference()).toEqual({ sidebarInitialized: true });
    });
  });

  describe('getJoinedAt', () => {
    it('reads the member’s join date, and nothing for a non-member or a removed member', async () => {
      const joinedAt = new Date('2026-01-02T03:04:05Z');
      await serverDB.insert(workspaceMembers).values([
        { joinedAt, userId: userA, workspaceId },
        { deletedAt: new Date(), userId: userB, workspaceId },
      ]);

      expect(
        await new WorkspaceUserSettingsModel(serverDB, userA, workspaceId).getJoinedAt(),
      ).toEqual(joinedAt);
      expect(
        await new WorkspaceUserSettingsModel(serverDB, userB, workspaceId).getJoinedAt(),
      ).toBeUndefined();
      expect(
        await new WorkspaceUserSettingsModel(serverDB, userA, 'ws-other').getJoinedAt(),
      ).toBeUndefined();
    });
  });
});
