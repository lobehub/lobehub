import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentEvalDatasetModel } from '../../models/agentEval/dataset';
import { ConnectorModel } from '../../models/connector';
import { ConnectorToolModel } from '../../models/connectorTool';
import {
  agentEvalDatasets,
  userConnectors,
  userConnectorTools,
  users,
  workspaces,
} from '../../schemas';
import { AgentEvalDatasetDeletionRepo } from './index';

const db = await getTestDB();
const userId = 'dataset-delete-owner';
const otherUserId = 'dataset-delete-other';
const workspaceId = 'dataset-delete-workspace';
const datasets = new AgentEvalDatasetModel(db, userId);
const deletion = new AgentEvalDatasetDeletionRepo(db, userId);
const gateKeeper = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext.replace(/^sealed:/, '') }),
  encrypt: async (plaintext: string) => `sealed:${plaintext}`,
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db.insert(workspaces).values({
    id: workspaceId,
    name: 'Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});
afterEach(async () => {
  await db.delete(agentEvalDatasets);
  await db.delete(workspaces);
  await db.delete(users);
});

const createConnection = (datasetId: string, actorId = userId, workspace?: string) =>
  ConnectorModel.forEvaluation(db, actorId, datasetId, workspace, gateKeeper).create({
    credentials: JSON.stringify({ token: 'fixture-private-token', type: 'bearer' }),
    identifier: `private-${crypto.randomUUID()}`,
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://fixture.test/mcp',
    name: 'Notion',
    sourceType: 'custom',
    status: 'connected',
  });

describe('Dataset deletion removes its private evaluation connections', () => {
  it('deletes owned marked credentials and cascades tools while keeping ordinary and other-Dataset rows', async () => {
    const first = await datasets.create({ identifier: 'first', name: 'First' });
    const second = await datasets.create({ identifier: 'second', name: 'Second' });
    const own = await createConnection(first.id);
    const otherDataset = await createConnection(second.id);
    const ordinary = await new ConnectorModel(db, userId, undefined, gateKeeper).create({
      credentials: JSON.stringify({ token: 'ordinary-private-token', type: 'bearer' }),
      identifier: 'notion',
      name: 'Notion',
      sourceType: 'custom',
      status: 'connected',
    });
    const [otherOwner] = await db
      .insert(userConnectors)
      .values({
        credentials: 'sealed:other-owner-secret',
        identifier: 'foreign-marker',
        metadata: { agentEval: { datasetId: first.id } },
        name: 'Other owner',
        sourceType: 'custom',
        status: 'connected',
        userId: otherUserId,
      })
      .returning();
    await ConnectorToolModel.forEvaluation(db, userId, first.id).upsertMany(own.id, [
      { crudType: 'read', toolName: 'read' },
    ]);
    await ConnectorToolModel.forEvaluation(db, userId, second.id).upsertMany(otherDataset.id, [
      { crudType: 'read', toolName: 'read' },
    ]);
    expect(own.credentials).toMatch(/^sealed:/);
    expect(await db.select().from(userConnectorTools)).toHaveLength(2);

    await deletion.deleteDataset(first.id);

    expect(await datasets.findById(first.id)).toBeUndefined();
    expect((await db.select().from(userConnectors)).map(({ id }) => id).sort()).toEqual(
      [ordinary.id, otherDataset.id, otherOwner.id].sort(),
    );
    expect(await db.select().from(userConnectorTools)).toMatchObject([
      { userConnectorId: otherDataset.id },
    ]);
    const preserved = await db.select().from(userConnectors);
    expect(preserved.find(({ id }) => id === ordinary.id)?.credentials).toBe(ordinary.credentials);
    expect(preserved.find(({ id }) => id === otherDataset.id)?.credentials).toBe(
      otherDataset.credentials,
    );
    expect(preserved.find(({ id }) => id === otherOwner.id)?.credentials).toBe(
      otherOwner.credentials,
    );
  });

  it('does not remove any connection when the Dataset is foreign, missing, or system-owned', async () => {
    const owned = await datasets.create({ identifier: 'owned', name: 'Owned' });
    const connection = await createConnection(owned.id);
    const [system] = await db
      .insert(agentEvalDatasets)
      .values({ identifier: 'system', name: 'System', userId: null })
      .returning();
    const [systemConnection] = await db
      .insert(userConnectors)
      .values({
        credentials: 'sealed:system-fixture-secret',
        identifier: 'system-connection',
        metadata: { agentEval: { datasetId: system.id } },
        name: 'System connection',
        sourceType: 'custom',
        status: 'connected',
        userId,
      })
      .returning();
    await new AgentEvalDatasetDeletionRepo(db, otherUserId).deleteDataset(owned.id);
    await deletion.deleteDataset('missing-dataset');
    await deletion.deleteDataset(system.id);
    expect((await db.select().from(userConnectors)).map(({ id }) => id).sort()).toEqual(
      [connection.id, systemConnection.id].sort(),
    );
    expect(await datasets.findById(owned.id)).toBeDefined();
  });

  it('cleans workspace connections across creators only from the authorized workspace scope', async () => {
    const workspaceDatasets = new AgentEvalDatasetModel(db, userId, workspaceId);
    const workspaceDeletion = new AgentEvalDatasetDeletionRepo(db, userId, workspaceId);
    const dataset = await workspaceDatasets.create({ identifier: 'shared', name: 'Shared' });
    const shared = await createConnection(dataset.id, otherUserId, workspaceId);
    await ConnectorToolModel.forEvaluation(db, userId, dataset.id, workspaceId).upsertMany(
      shared.id,
      [{ crudType: 'read', toolName: 'read' }],
    );
    await deletion.deleteDataset(dataset.id);
    expect(
      await db.select().from(userConnectors).where(eq(userConnectors.id, shared.id)),
    ).toHaveLength(1);

    await workspaceDeletion.deleteDataset(dataset.id);
    expect(await db.select().from(userConnectors)).toEqual([]);
    expect(await db.select().from(userConnectorTools)).toEqual([]);
  });
});
