import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { AgentEvalDatasetModel } from '../../models/agentEval/dataset';
import { agentEvalDatasets, agentEvalEnvironments, agentEvalTestCases, users } from '../../schemas';
import { AgentEvalDatasetDeletionRepo } from '../agentEvalDatasetDeletion';
import { AgentEvalEnvironmentConnectionError, AgentEvalEnvironmentConnectionRepo } from './index';

const db = await getTestDB();
const userId = 'stored-connection-owner';
const otherUserId = 'stored-connection-other';
const datasets = new AgentEvalDatasetModel(db, userId);
const repo = new AgentEvalEnvironmentConnectionRepo(db, userId);

const manifest = {
  api: [{ description: 'Read mail', name: 'read', parameters: { properties: {}, type: 'object' } }],
  identifier: 'gmail',
  meta: { title: 'Gmail' },
  type: 'mcp',
};

/** An Environment holding a stored gmail connection, bound by its own `env:` id. */
const createEnvironment = async (owner: string | null, id: string = crypto.randomUUID()) => {
  await db.insert(agentEvalEnvironments).values({
    config: {
      connections: {
        gmail: {
          credentials: 'sealed:{"token":"t","type":"bearer"}',
          name: 'Gmail',
          url: 'https://mock.test/mcp/ds/gmail',
        },
      },
      connectorBindings: { gmail: { connectorId: `env:${id}:gmail`, transport: 'lobe-bench' } },
      mock: { services: ['gmail'] },
      toolManifests: { gmail: manifest },
    },
    id,
    name: 'Shared world',
    userId: owner,
  } as never);
  return id;
};

const useEnvironment = (datasetId: string, environmentId: string, owner = userId) =>
  db.insert(agentEvalTestCases).values({
    content: { input: 'Check my mail' },
    datasetId,
    environmentId,
    userId: owner,
  });

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});
afterEach(async () => {
  await db.delete(agentEvalDatasets);
  await db.delete(agentEvalEnvironments);
  await db.delete(users);
});

describe('connections stored in Environments', () => {
  it('reaches a stored connection only through a Dataset whose cases use its Environment', async () => {
    const used = await datasets.create({ identifier: 'used', name: 'Used' });
    const other = await datasets.create({ identifier: 'other', name: 'Other' });
    const environmentId = await createEnvironment(userId);
    await useEnvironment(used.id, environmentId);

    const found = await repo.find(used.id, `env:${environmentId}:gmail`);
    expect(found).toMatchObject({
      connection: { url: 'https://mock.test/mcp/ds/gmail' },
      environmentId,
      mutable: true,
      service: 'gmail',
      toolManifest: manifest,
      transport: 'lobe-bench',
    });
    expect(await repo.find(other.id, `env:${environmentId}:gmail`)).toBeUndefined();
    expect(await repo.find(used.id, `env:${environmentId}:slack`)).toBeUndefined();
    expect(await repo.listForDataset(used.id)).toHaveLength(1);
    expect(await repo.listForDataset(other.id)).toHaveLength(0);
  });

  it('does not reach another account’s Environment', async () => {
    const mine = await datasets.create({ identifier: 'mine', name: 'Mine' });
    const environmentId = await createEnvironment(otherUserId);
    await useEnvironment(mine.id, environmentId);
    expect(await repo.find(mine.id, `env:${environmentId}:gmail`)).toBeUndefined();
  });

  it('changes the address and keeps the credentials unless new ones are given', async () => {
    const dataset = await datasets.create({ identifier: 'edit', name: 'Edit' });
    const environmentId = await createEnvironment(userId);
    await useEnvironment(dataset.id, environmentId);

    await repo.update(dataset.id, `env:${environmentId}:gmail`, {
      url: 'https://moved.test/mcp/ds/gmail',
    });
    const [row] = await db
      .select()
      .from(agentEvalEnvironments)
      .where(eq(agentEvalEnvironments.id, environmentId));
    expect(row.config.connections?.gmail).toEqual({
      credentials: 'sealed:{"token":"t","type":"bearer"}',
      name: 'Gmail',
      url: 'https://moved.test/mcp/ds/gmail',
    });
  });

  it('refuses to change a built-in Environment or one another Dataset also uses', async () => {
    const first = await datasets.create({ identifier: 'first', name: 'First' });
    const second = await datasets.create({ identifier: 'second', name: 'Second' });
    const builtIn = await createEnvironment(null);
    await useEnvironment(first.id, builtIn);
    await expect(
      repo.update(first.id, `env:${builtIn}:gmail`, { url: 'https://x.test/mcp/a/gmail' }),
    ).rejects.toBeInstanceOf(AgentEvalEnvironmentConnectionError);

    const shared = await createEnvironment(userId);
    await useEnvironment(first.id, shared);
    await useEnvironment(second.id, shared);
    await expect(
      repo.update(first.id, `env:${shared}:gmail`, { url: 'https://x.test/mcp/a/gmail' }),
    ).rejects.toThrow('shared with another dataset');
  });

  it('deletes an Environment holding stored connections with the last Dataset using it', async () => {
    const deletion = new AgentEvalDatasetDeletionRepo(db, userId);
    const first = await datasets.create({ identifier: 'first', name: 'First' });
    const second = await datasets.create({ identifier: 'second', name: 'Second' });
    const own = await createEnvironment(userId);
    const shared = await createEnvironment(userId);
    await useEnvironment(first.id, own);
    await useEnvironment(first.id, shared);
    await useEnvironment(second.id, shared);

    await deletion.deleteDataset(first.id);
    const remaining = (await db.select().from(agentEvalEnvironments)).map(({ id }) => id);
    expect(remaining).not.toContain(own);
    expect(remaining).toContain(shared);
  });
});
