import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentEvalDatasetWriteError } from '../../../models/agentEval/datasetAccess';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  userConnectors,
  users,
} from '../../../schemas';
import { AgentEvalDatasetConnectorRepo } from '../datasetConnectorBindings';
import { AgentEvalDatasetPackageRepo } from '../index';

const db = await getTestDB();
const userId = 'binding-owner';
const otherId = 'binding-other';
const connector = { connectorId: 'b34a8f4d-349a-41a9-b307-3a8754e8e5a8' };
const repository = new AgentEvalDatasetConnectorRepo(db, userId);
const packageRepo = new AgentEvalDatasetPackageRepo(db, userId);
const pack = (): AgentEvalDatasetPackage => ({
  cases: [
    { content: { input: 'One' }, environmentKey: 'shared', key: 'one' },
    {
      content: { environment: { mock: { services: ['notion'] } }, input: 'Two' },
      environmentKey: 'shared',
      key: 'two',
    },
  ],
  dataset: {
    evalMode: 'equals',
    metadata: { release: 'stable-release' },
    name: 'Connection repair',
  },
  environments: [
    {
      config: { memory: {}, mock: { services: ['calendar', 'notion'] } },
      key: 'shared',
      name: 'Shared',
    },
  ],
  format: 'lobehub-eval-dataset',
  version: 1,
});
const importPackage = async () => {
  const result = await packageRepo.importPackage({ package: pack(), sha256: 'c'.repeat(64) });
  await db
    .insert(userConnectors)
    .values({
      id: connector.connectorId,
      identifier: 'eval-private',
      name: 'Eval',
      sourceType: 'custom',
      status: 'connected',
      userId,
      metadata: { agentEval: { datasetId: result.datasetId } },
    })
    .onConflictDoNothing();
  return result;
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
});
afterEach(async () => {
  await db.delete(agentEvalTestCases);
  await db.delete(agentEvalDatasets);
  await db.delete(agentEvalEnvironments);
  await db.delete(agentEvalBenchmarks);
  await db.delete(users);
});

describe('installed dataset connector bindings', () => {
  it('rejects a connection from another Dataset even within the same account', async () => {
    await importPackage();
    const second = await importPackage();
    const { requirements } = await repository.getBindings(second.datasetId);
    await expect(
      repository.updateBindings(second.datasetId, {
        environmentBindings: { [requirements[0].key]: { calendar: connector, notion: connector } },
      }),
    ).rejects.toThrow('another Dataset');
    expect((await repository.getBindings(second.datasetId)).requirements[0].bindings).toEqual({});
  });

  it('reads built-in dataset requirements while keeping built-in datasets and environments read-only', async () => {
    const { datasetId } = await importPackage();
    const before = await repository.getBindings(datasetId);
    const environmentId = before.requirements.find((item) => item.scope === 'environment')!.key;
    await db
      .update(agentEvalDatasets)
      .set({ userId: null })
      .where(eq(agentEvalDatasets.id, datasetId));
    await db
      .update(agentEvalEnvironments)
      .set({ userId: null })
      .where(eq(agentEvalEnvironments.id, environmentId));
    await db
      .update(agentEvalTestCases)
      .set({ userId: null })
      .where(eq(agentEvalTestCases.datasetId, datasetId));
    expect(
      (await repository.getBindings(datasetId)).requirements.map((item) => item.services),
    ).toEqual(before.requirements.map((item) => item.services));
    await expect(
      repository.updateBindings(datasetId, {
        environmentBindings: { [environmentId]: { calendar: connector, notion: connector } },
      }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await db.update(agentEvalDatasets).set({ userId }).where(eq(agentEvalDatasets.id, datasetId));
    await db
      .update(agentEvalTestCases)
      .set({ userId })
      .where(eq(agentEvalTestCases.datasetId, datasetId));
    await expect(
      repository.updateBindings(datasetId, {
        environmentBindings: { [environmentId]: { calendar: connector, notion: connector } },
      }),
    ).rejects.toThrow('unavailable');
  });

  it('repairs Environment bindings while preserving case content and release identity', async () => {
    const { datasetId } = await importPackage();
    const before = await repository.getBindings(datasetId);
    expect(before.requirements.map((item) => [item.scope, item.services])).toEqual([
      ['environment', ['calendar', 'notion']],
    ]);
    const environment = before.requirements[0];
    await repository.updateBindings(datasetId, {
      environmentBindings: { [environment.key]: { calendar: connector, notion: connector } },
    });
    const result = await repository.getBindings(datasetId);
    expect(result.requirements[0].bindings).toEqual({ calendar: connector, notion: connector });
    const [dataset] = await db
      .select()
      .from(agentEvalDatasets)
      .where(eq(agentEvalDatasets.id, datasetId));
    expect(dataset.metadata?.release).toBe('stable-release');
    const [storedEnvironment] = await db
      .select()
      .from(agentEvalEnvironments)
      .where(eq(agentEvalEnvironments.id, environment.key));
    expect(storedEnvironment.config.memory).toEqual({});
    const cases = await db
      .select()
      .from(agentEvalTestCases)
      .where(eq(agentEvalTestCases.datasetId, datasetId));
    expect(cases.find((item) => item.content.input === 'Two')?.content.environment).toEqual({
      mock: { services: ['notion'] },
    });
  });

  it('refuses a binding chosen for a case: connections belong to the Environment', async () => {
    const { datasetId } = await importPackage();
    const [testCase] = await db
      .select()
      .from(agentEvalTestCases)
      .where(eq(agentEvalTestCases.datasetId, datasetId));
    await expect(
      repository.updateBindings(datasetId, {
        caseBindings: { [testCase.id]: { notion: connector } },
      }),
    ).rejects.toThrow('belong to an Environment');
  });

  it('rejects another account and unknown targets without partially updating valid targets', async () => {
    const { datasetId } = await importPackage();
    const foreign = new AgentEvalDatasetConnectorRepo(db, otherId);
    await expect(foreign.getBindings(datasetId)).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await expect(foreign.updateBindings(datasetId, {})).rejects.toBeInstanceOf(
      AgentEvalDatasetWriteError,
    );
    const { requirements } = await repository.getBindings(datasetId);
    await expect(
      repository.updateBindings(datasetId, {
        environmentBindings: {
          [requirements[0].key]: { calendar: connector, notion: connector },
          unknown: { notion: connector },
        },
      }),
    ).rejects.toThrow('unavailable');
    expect((await repository.getBindings(datasetId)).requirements[0].bindings).toEqual({});
  });

  it('refuses to change an environment also used by a different dataset', async () => {
    const first = await importPackage();
    const second = await importPackage();
    const { requirements } = await repository.getBindings(first.datasetId);
    await db
      .update(agentEvalTestCases)
      .set({ environmentId: requirements[0].key })
      .where(eq(agentEvalTestCases.datasetId, second.datasetId));
    await expect(
      repository.updateBindings(first.datasetId, {
        environmentBindings: { [requirements[0].key]: { calendar: connector, notion: connector } },
      }),
    ).rejects.toThrow('shared with another dataset');
    expect((await repository.getBindings(first.datasetId)).requirements[0].bindings).toEqual({});
  });

  it('allows repair when the other Dataset only has retired references to the environment', async () => {
    const first = await importPackage();
    const second = await importPackage();
    const { requirements } = await repository.getBindings(first.datasetId);
    await db
      .update(agentEvalTestCases)
      .set({ environmentId: requirements[0].key, metadata: { retired: true } })
      .where(eq(agentEvalTestCases.datasetId, second.datasetId));
    await repository.updateBindings(first.datasetId, {
      environmentBindings: { [requirements[0].key]: { calendar: connector, notion: connector } },
    });
    expect((await repository.getBindings(first.datasetId)).requirements[0].bindings).toEqual({
      calendar: connector,
      notion: connector,
    });
  });

  it('rebinds an Environment to a connection stored in it', async () => {
    const input = pack();
    input.connections = {
      calendar: { name: 'Calendar', url: 'https://mock.test/mcp/a/calendar' },
      notion: { name: 'Notion', url: 'https://mock.test/mcp/a/notion' },
    };
    input.environments[0].connectionBindings = {
      calendar: { connectionKey: 'calendar', transport: 'lobe-bench' },
      notion: { connectionKey: 'notion', transport: 'lobe-bench' },
    };
    const { datasetId } = await packageRepo.importPackage({
      package: input,
      sha256: 'd'.repeat(64),
    });
    const [requirement] = (await repository.getBindings(datasetId)).requirements;
    expect(requirement.bindings.notion.connectorId).toBe(`env:${requirement.key}:notion`);
    await repository.updateBindings(datasetId, {
      environmentBindings: { [requirement.key]: requirement.bindings },
    });
    expect((await repository.getBindings(datasetId)).requirements[0].bindings).toEqual(
      requirement.bindings,
    );
  });
});
