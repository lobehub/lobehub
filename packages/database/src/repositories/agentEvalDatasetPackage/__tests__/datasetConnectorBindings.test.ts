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
      content: { environment: { toolForwarding: { calendar: {} } }, input: 'Two' },
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
    { config: { memory: {}, mock: { services: ['notion'] } }, key: 'shared', name: 'Shared' },
  ],
  format: 'lobehub-eval-dataset',
  version: 1,
});
const importPackage = () => packageRepo.importPackage({ package: pack(), sha256: 'c'.repeat(64) });

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
        environmentBindings: { [environmentId]: { notion: connector } },
      }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetWriteError);
    await db.update(agentEvalDatasets).set({ userId }).where(eq(agentEvalDatasets.id, datasetId));
    await db
      .update(agentEvalTestCases)
      .set({ userId })
      .where(eq(agentEvalTestCases.datasetId, datasetId));
    await expect(
      repository.updateBindings(datasetId, {
        environmentBindings: { [environmentId]: { notion: connector } },
      }),
    ).rejects.toThrow('unavailable');
  });

  it('repairs shared and inline bindings together while preserving case content and release identity', async () => {
    const { datasetId } = await importPackage();
    const before = await repository.getBindings(datasetId);
    expect(before.requirements.map((item) => item.services)).toEqual([
      ['notion'],
      ['calendar', 'notion'],
    ]);
    const environment = before.requirements.find((item) => item.scope === 'environment')!;
    const testCase = before.requirements.find((item) => item.scope === 'case')!;
    await repository.updateBindings(datasetId, {
      caseBindings: { [testCase.key]: { calendar: connector, notion: connector } },
      environmentBindings: { [environment.key]: { notion: connector } },
    });
    const result = await repository.getBindings(datasetId);
    expect(
      result.requirements.every(
        (item) => Object.keys(item.bindings).length === item.services.length,
      ),
    ).toBe(true);
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
    const [storedCase] = await db
      .select()
      .from(agentEvalTestCases)
      .where(eq(agentEvalTestCases.id, testCase.key));
    expect(storedCase.content.input).toBe('Two');
    expect(storedCase.content.environment?.toolForwarding).toEqual({ calendar: {} });
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
        caseBindings: { unknown: { notion: connector } },
        environmentBindings: { [requirements[0].key]: { notion: connector } },
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
        environmentBindings: { [requirements[0].key]: { notion: connector } },
      }),
    ).rejects.toThrow('shared with another dataset');
    expect((await repository.getBindings(first.datasetId)).requirements[0].bindings).toEqual({});
  });

  it('does not present inherited targets as bound when a case explicitly overrides its bindings', async () => {
    const { datasetId } = await importPackage();
    const { requirements } = await repository.getBindings(datasetId);
    const environment = requirements.find((item) => item.scope === 'environment')!;
    const testCase = requirements.find((item) => item.scope === 'case')!;
    await repository.updateBindings(datasetId, {
      environmentBindings: { [environment.key]: { notion: connector } },
    });
    await db
      .update(agentEvalTestCases)
      .set({
        content: {
          input: 'Two',
          environment: { connectorBindings: {}, toolForwarding: { calendar: {} } },
        },
      })
      .where(eq(agentEvalTestCases.id, testCase.key));
    const repaired = await repository.getBindings(datasetId);
    expect(repaired.requirements.find((item) => item.scope === 'case')?.bindings).toEqual({});
  });
});
