import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  users,
} from '../../../schemas';
import { ConnectorModel } from '../../connector';
import { AgentEvalDatasetModel } from '../dataset';
import { AgentEvalEnvironmentModel } from '../environment';
import { AgentEvalTestCaseModel } from '../testCase';

const db = await getTestDB();
const userId = 'eval-environment-binding-owner';
const datasets = new AgentEvalDatasetModel(db, userId);
const cases = new AgentEvalTestCaseModel(db, userId);
const environments = new AgentEvalEnvironmentModel(db, userId);

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});
afterEach(async () => {
  await db.delete(agentEvalTestCases);
  await db.delete(agentEvalEnvironments);
  await db.delete(agentEvalDatasets);
  await db.delete(users);
});

const fixture = async () => {
  const first = await datasets.create({ identifier: 'first', name: 'First Dataset' });
  const second = await datasets.create({ identifier: 'second', name: 'Second Dataset' });
  const connector = await ConnectorModel.forEvaluation(db, userId, first.id).create({
    identifier: 'first-connection',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://fixture.test/mcp/first/notion',
    name: 'Notion',
    sourceType: 'custom',
    status: 'connected',
  });
  const config = { connectorBindings: { notion: { connectorId: connector.id } } };
  const environment = await environments.create({ config, name: 'First Dataset environment' });
  return { config, connector, environment, first, second };
};

describe('Dataset ownership of assigned Environment connections', () => {
  it('rejects a same-owner other-Dataset Environment in create, batch, update, and dataset copies atomically', async () => {
    const { environment, first, second } = await fixture();
    const original = await cases.create({ content: { input: 'Original' }, datasetId: second.id });
    const foreignAssignment = {
      content: { input: 'Cross Dataset' },
      datasetId: second.id,
      environmentId: environment.id,
    };
    await expect(cases.create(foreignAssignment)).rejects.toThrow('another Dataset');
    await expect(
      cases.batchCreate([{ ...foreignAssignment, datasetId: first.id }, foreignAssignment]),
    ).rejects.toThrow('another Dataset');
    await expect(cases.update(original.id, { environmentId: environment.id })).rejects.toThrow(
      'another Dataset',
    );
    await expect(
      datasets.create({ identifier: 'copy', name: 'Copy' }, [
        { content: { input: 'Copy' }, environmentId: environment.id },
      ]),
    ).rejects.toThrow('another Dataset');
    expect(await db.select().from(agentEvalTestCases)).toEqual([original]);
    expect((await datasets.queryList()).map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('also rejects cross-Dataset inline bindings through direct model calls and preserves prior content', async () => {
    const { config, first, second } = await fixture();
    const original = await cases.create({ content: { input: 'Original' }, datasetId: second.id });
    const foreignAssignment = {
      content: { environment: config, input: 'Cross Dataset' },
      datasetId: second.id,
    };
    await expect(cases.create(foreignAssignment)).rejects.toThrow('another Dataset');
    await expect(
      cases.batchCreate([{ ...foreignAssignment, datasetId: first.id }, foreignAssignment]),
    ).rejects.toThrow('another Dataset');
    await expect(cases.update(original.id, { content: { environment: config } })).rejects.toThrow(
      'another Dataset',
    );
    await expect(
      datasets.create({ identifier: 'inline-copy', name: 'Copy' }, [foreignAssignment]),
    ).rejects.toThrow('another Dataset');
    expect(await cases.findById(original.id)).toEqual(original);
    expect(await db.select().from(agentEvalTestCases)).toEqual([original]);
    expect(await datasets.count()).toBe(2);
  });

  it('validates all referenced bindings even when the case overrides them with an empty set', async () => {
    const { environment, second } = await fixture();
    await expect(
      cases.create({
        content: { environment: { connectorBindings: {} }, input: 'Shadowed' },
        datasetId: second.id,
        environmentId: environment.id,
      }),
    ).rejects.toThrow('another Dataset');
    expect(await db.select().from(agentEvalTestCases)).toEqual([]);
  });

  it('allows same-Dataset shared and inline connections across environments and case updates', async () => {
    const { config, environment, first } = await fixture();
    const secondEnvironment = await environments.create({ config, name: 'Another environment' });
    const firstCase = await cases.create({
      content: { input: 'Shared' },
      datasetId: first.id,
      environmentId: environment.id,
    });
    const added = await cases.batchCreate([
      { content: { input: 'Another' }, datasetId: first.id, environmentId: secondEnvironment.id },
      { content: { environment: config, input: 'Inline' }, datasetId: first.id },
    ]);
    expect(added).toHaveLength(2);
    expect(
      await cases.update(firstCase.id, {
        content: { environment: config },
        environmentId: secondEnvironment.id,
      }),
    ).toMatchObject({ content: { environment: config, input: 'Shared' } });
  });

  it('keeps environments without bindings reusable across Datasets and dataset creation', async () => {
    const first = await datasets.create({ identifier: 'first', name: 'First' });
    const second = await datasets.create({ identifier: 'second', name: 'Second' });
    const environment = await environments.create({
      config: { connectorBindings: {}, mock: { services: ['notion'] } },
      name: 'Unbound shared environment',
    });
    const added = await cases.batchCreate(
      [first, second].map(({ id }) => ({
        content: { input: 'Shared' },
        datasetId: id,
        environmentId: environment.id,
      })),
    );
    expect(added).toHaveLength(2);
    const copy = await datasets.create({ identifier: 'copy', name: 'Copy' }, [
      { content: { input: 'Copied' }, environmentId: environment.id },
    ]);
    expect((await datasets.findById(copy.id))?.testCases).toHaveLength(1);
  });

  it('rejects ordinary or missing connection UUIDs even from an otherwise readable Environment', async () => {
    const dataset = await datasets.create({ identifier: 'ordinary', name: 'Dataset' });
    const ordinary = await new ConnectorModel(db, userId).create({
      identifier: 'notion',
      name: 'Notion',
      sourceType: 'custom',
      status: 'connected',
    });
    for (const connectorId of [ordinary.id, crypto.randomUUID()]) {
      const environment = await environments.create({
        config: { connectorBindings: { notion: { connectorId } } },
        name: 'Invalid connection environment',
      });
      await expect(
        cases.create({
          content: { input: 'Unavailable' },
          datasetId: dataset.id,
          environmentId: environment.id,
        }),
      ).rejects.toThrow('another Dataset');
    }
    expect(await db.select().from(agentEvalTestCases)).toEqual([]);
  });
});
