import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewUserConnector } from '../../schemas';
import {
  ConnectorToolPermission,
  ToolCRUDType,
  userConnectors,
  userConnectorTools,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ConnectorToolModel, type SyncToolInput } from '../connectorTool';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'connector-tool-user';
const otherUserId = 'connector-tool-other-user';
const workspaceId = 'connector-tool-workspace';

let connectorId: string;
let otherConnectorId: string;
let workspaceConnectorId: string;

const baseConnector = (overrides: Partial<NewUserConnector>): NewUserConnector => ({
  identifier: 'linear',
  name: 'Linear',
  sourceType: 'builtin',
  status: 'connected',
  userId,
  ...overrides,
});

const insertConnector = async (overrides: Partial<NewUserConnector>): Promise<string> => {
  const [row] = await serverDB.insert(userConnectors).values(baseConnector(overrides)).returning();
  return row.id;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'ws' });

  // Personal-mode connector for `userId`
  connectorId = await insertConnector({ identifier: 'linear' });
  // Another user's connector
  otherConnectorId = await insertConnector({ identifier: 'github', userId: otherUserId });
  // Workspace-scoped connector
  workspaceConnectorId = await insertConnector({ identifier: 'slack', workspaceId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

const tool = (overrides: Partial<SyncToolInput>): SyncToolInput => ({
  crudType: ToolCRUDType.read,
  toolName: 'search',
  ...overrides,
});

describe('ConnectorToolModel', () => {
  describe('upsertMany', () => {
    it('returns early without inserting when the tool list is empty', async () => {
      const model = new ConnectorToolModel(serverDB, userId);

      await model.upsertMany(connectorId, []);

      const rows = await serverDB.select().from(userConnectorTools);
      expect(rows).toHaveLength(0);
    });

    it('inserts tools with defaults applied for omitted optional fields', async () => {
      const model = new ConnectorToolModel(serverDB, userId);

      await model.upsertMany(connectorId, [tool({ toolName: 'search' })]);

      const rows = await model.queryByConnector(connectorId);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.toolName).toBe('search');
      expect(row.userId).toBe(userId);
      expect(row.workspaceId).toBeNull();
      expect(row.userConnectorId).toBe(connectorId);
      expect(row.crudType).toBe(ToolCRUDType.read);
      // omitted optional fields default to null
      expect(row.description).toBeNull();
      expect(row.displayName).toBeNull();
      expect(row.inputSchema).toBeNull();
      expect(row.outputSchema).toBeNull();
      expect(row.renderConfig).toBeNull();
      // default permission is `auto`
      expect(row.permission).toBe(ConnectorToolPermission.auto);
      expect(row.isWorkArtifact).toBe(false);
    });

    it('persists all provided manifest fields and the default permission override', async () => {
      const model = new ConnectorToolModel(serverDB, userId);

      await model.upsertMany(connectorId, [
        tool({
          crudType: ToolCRUDType.write,
          defaultPermission: ConnectorToolPermission.needs_approval,
          description: 'Create an issue',
          displayName: 'Create Issue',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'string' },
          renderConfig: { streaming: true },
          toolName: 'create_issue',
        }),
      ]);

      const [row] = await model.queryByConnector(connectorId);
      expect(row.crudType).toBe(ToolCRUDType.write);
      expect(row.permission).toBe(ConnectorToolPermission.needs_approval);
      expect(row.description).toBe('Create an issue');
      expect(row.displayName).toBe('Create Issue');
      expect(row.inputSchema).toEqual({ type: 'object' });
      expect(row.outputSchema).toEqual({ type: 'string' });
      expect(row.renderConfig).toEqual({ streaming: true });
    });

    it('inserts multiple tools at once', async () => {
      const model = new ConnectorToolModel(serverDB, userId);

      await model.upsertMany(connectorId, [
        tool({ toolName: 'search' }),
        tool({ toolName: 'create_issue', crudType: ToolCRUDType.write }),
      ]);

      const rows = await model.queryByConnector(connectorId);
      expect(rows.map((r) => r.toolName).sort()).toEqual(['create_issue', 'search']);
    });

    it('overwrites manifest fields but preserves user-controlled fields on conflict', async () => {
      const model = new ConnectorToolModel(serverDB, userId);

      // initial insert
      await model.upsertMany(connectorId, [
        tool({
          description: 'old description',
          displayName: 'Old Name',
          toolName: 'search',
        }),
      ]);

      const [initial] = await model.queryByConnector(connectorId);
      // user changes permission + work-artifact flag (user-controlled)
      await serverDB
        .update(userConnectorTools)
        .set({ isWorkArtifact: true, permission: ConnectorToolPermission.disabled })
        .where(eq(userConnectorTools.id, initial.id));

      // re-sync the same tool with new manifest fields and a different default permission
      await model.upsertMany(connectorId, [
        tool({
          defaultPermission: ConnectorToolPermission.needs_approval,
          description: 'new description',
          displayName: 'New Name',
          toolName: 'search',
        }),
      ]);

      const rows = await model.queryByConnector(connectorId);
      // still a single row (upsert, not duplicate insert)
      expect(rows).toHaveLength(1);
      const row = rows[0];
      // manifest fields overwritten
      expect(row.description).toBe('new description');
      expect(row.displayName).toBe('New Name');
      // user-controlled fields preserved
      expect(row.permission).toBe(ConnectorToolPermission.disabled);
      expect(row.isWorkArtifact).toBe(true);
    });

    it('writes workspaceId when the model is workspace-scoped', async () => {
      const model = new ConnectorToolModel(serverDB, userId, workspaceId);

      await model.upsertMany(workspaceConnectorId, [tool({ toolName: 'search' })]);

      const [row] = await serverDB
        .select()
        .from(userConnectorTools)
        .where(eq(userConnectorTools.userConnectorId, workspaceConnectorId));
      expect(row.workspaceId).toBe(workspaceId);
    });
  });

  describe('updatePermission', () => {
    it('updates the permission of a tool owned by the user', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'search' })]);
      const [created] = await model.queryByConnector(connectorId);

      await model.updatePermission(created.id, ConnectorToolPermission.disabled);

      const [row] = await serverDB
        .select()
        .from(userConnectorTools)
        .where(eq(userConnectorTools.id, created.id));
      expect(row.permission).toBe(ConnectorToolPermission.disabled);
    });

    it('does not update a tool owned by another user', async () => {
      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [tool({ toolName: 'search' })]);
      const [created] = await otherModel.queryByConnector(otherConnectorId);

      const model = new ConnectorToolModel(serverDB, userId);
      await model.updatePermission(created.id, ConnectorToolPermission.disabled);

      const [row] = await serverDB
        .select()
        .from(userConnectorTools)
        .where(eq(userConnectorTools.id, created.id));
      // unchanged — still the default `auto`
      expect(row.permission).toBe(ConnectorToolPermission.auto);
    });
  });

  describe('queryByConnector', () => {
    it('returns only the tools of the given connector for the current user', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [
        tool({ toolName: 'search' }),
        tool({ toolName: 'create_issue', crudType: ToolCRUDType.write }),
      ]);

      // another user's tool on another connector must not leak
      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [tool({ toolName: 'leak' })]);

      const rows = await model.queryByConnector(connectorId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.userId === userId)).toBe(true);
    });

    it('returns an empty array for a connector with no tools', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      expect(await model.queryByConnector(connectorId)).toEqual([]);
    });
  });

  describe('queryByConnectorIds', () => {
    it('returns an empty array for an empty id list', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      expect(await model.queryByConnectorIds([])).toEqual([]);
    });

    it('excludes disabled tools', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [
        tool({ toolName: 'enabled' }),
        tool({ defaultPermission: ConnectorToolPermission.disabled, toolName: 'disabled' }),
        tool({ defaultPermission: ConnectorToolPermission.needs_approval, toolName: 'needs' }),
      ]);

      const rows = await model.queryByConnectorIds([connectorId]);
      expect(rows.map((r) => r.toolName).sort()).toEqual(['enabled', 'needs']);
    });

    it('does not leak tools owned by another user', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'mine' })]);

      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [tool({ toolName: 'theirs' })]);

      // even when explicitly asking for the other user's connector id, ownership filters it out
      const rows = await model.queryByConnectorIds([connectorId, otherConnectorId]);
      expect(rows.map((r) => r.toolName)).toEqual(['mine']);
    });
  });

  describe('queryAllByConnectorIds', () => {
    it('returns an empty array for an empty id list', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      expect(await model.queryAllByConnectorIds([])).toEqual([]);
    });

    it('includes disabled tools', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [
        tool({ toolName: 'enabled' }),
        tool({ defaultPermission: ConnectorToolPermission.disabled, toolName: 'disabled' }),
      ]);

      const rows = await model.queryAllByConnectorIds([connectorId]);
      expect(rows.map((r) => r.toolName).sort()).toEqual(['disabled', 'enabled']);
    });

    it('does not leak tools owned by another user', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'mine' })]);

      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [
        tool({ defaultPermission: ConnectorToolPermission.disabled, toolName: 'theirs' }),
      ]);

      const rows = await model.queryAllByConnectorIds([connectorId, otherConnectorId]);
      expect(rows.map((r) => r.toolName)).toEqual(['mine']);
    });
  });

  describe('findByToolName', () => {
    it('returns the tool matching the name for the current user', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [
        tool({ toolName: 'search' }),
        tool({ toolName: 'create_issue', crudType: ToolCRUDType.write }),
      ]);

      const found = await model.findByToolName('create_issue');
      expect(found?.toolName).toBe('create_issue');
      expect(found?.userId).toBe(userId);
    });

    it('returns undefined when no tool matches the name', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'search' })]);

      expect(await model.findByToolName('missing')).toBeUndefined();
    });

    it('returns undefined when the matching tool belongs to another user', async () => {
      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [tool({ toolName: 'theirs' })]);

      const model = new ConnectorToolModel(serverDB, userId);
      expect(await model.findByToolName('theirs')).toBeUndefined();
    });
  });

  describe('deleteToolsNotIn', () => {
    it('deletes rows whose toolName is not in the keep list', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [
        tool({ toolName: 'keep_a' }),
        tool({ toolName: 'keep_b' }),
        tool({ toolName: 'stale' }),
      ]);

      await model.deleteToolsNotIn(connectorId, ['keep_a', 'keep_b']);

      const rows = await model.queryAllByConnectorIds([connectorId]);
      expect(rows.map((r) => r.toolName).sort()).toEqual(['keep_a', 'keep_b']);
    });

    it('deletes all tools for the connector when the keep list is empty', async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'a' }), tool({ toolName: 'b' })]);

      await model.deleteToolsNotIn(connectorId, []);

      expect(await model.queryAllByConnectorIds([connectorId])).toHaveLength(0);
    });

    it("does not touch another user's tools with the same name", async () => {
      const model = new ConnectorToolModel(serverDB, userId);
      await model.upsertMany(connectorId, [tool({ toolName: 'shared' })]);

      const otherModel = new ConnectorToolModel(serverDB, otherUserId);
      await otherModel.upsertMany(otherConnectorId, [tool({ toolName: 'shared' })]);

      // Pruning to empty for our connector must not affect the other user's row.
      await model.deleteToolsNotIn(connectorId, []);

      const theirs = await otherModel.queryAllByConnectorIds([otherConnectorId]);
      expect(theirs.map((r) => r.toolName)).toEqual(['shared']);
    });
  });

  describe('ownership in workspace mode', () => {
    it('isolates personal-mode tools from workspace-scoped queries', async () => {
      // personal tool (workspaceId IS NULL)
      const personalModel = new ConnectorToolModel(serverDB, userId);
      await personalModel.upsertMany(connectorId, [tool({ toolName: 'personal' })]);

      // workspace tool
      const wsModel = new ConnectorToolModel(serverDB, userId, workspaceId);
      await wsModel.upsertMany(workspaceConnectorId, [tool({ toolName: 'ws' })]);

      const wsRows = await wsModel.queryByConnectorIds([connectorId, workspaceConnectorId]);
      expect(wsRows.map((r) => r.toolName)).toEqual(['ws']);

      const personalRows = await personalModel.queryByConnectorIds([
        connectorId,
        workspaceConnectorId,
      ]);
      expect(personalRows.map((r) => r.toolName)).toEqual(['personal']);
    });
  });
});
