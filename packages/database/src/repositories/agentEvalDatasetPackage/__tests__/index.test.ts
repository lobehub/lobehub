import type { AgentEvalDatasetPackage } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentEvalDatasetWriteError } from '../../../models/agentEval/datasetAccess';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalRuns,
  agentEvalTestCases,
  userConnectors,
  users,
  workspaces,
} from '../../../schemas';
import { AgentEvalDatasetPackageImportError, AgentEvalDatasetPackageRepo } from '../index';

const db = await getTestDB();
const userId = 'package-owner';
const otherId = 'package-other';
const workspaceId = 'package-workspace';
const repo = new AgentEvalDatasetPackageRepo(db, userId);
const encryptionKey = await crypto.subtle.generateKey({ length: 256, name: 'AES-GCM' }, false, [
  'encrypt',
]);
const secureRepo = new AgentEvalDatasetPackageRepo(db, userId, undefined, {
  encrypt: async (plaintext) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { iv, name: 'AES-GCM' },
      encryptionKey,
      new TextEncoder().encode(plaintext),
    );
    return Buffer.from(ciphertext).toString('base64');
  },
});
const pack = (): AgentEvalDatasetPackage => ({
  cases: [
    {
      key: 'one',
      content: { input: 'Repeat hello', messages: [{ role: 'user', content: 'hello' }] },
      environmentKey: 'world',
      evalMode: 'equals',
      evalConfig: { expected: 'hello' },
    },
  ],
  dataset: { name: 'Synthetic package', evalMode: 'equals' },
  environments: [{ key: 'world', name: 'Synthetic environment', config: { memory: {} } }],
  format: 'lobehub-eval-dataset',
  version: 1,
});
const params = () => ({ package: pack(), sha256: 'a'.repeat(64) });

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Shared', primaryOwnerId: userId, slug: workspaceId });
});
afterEach(async () => {
  await db.delete(agentEvalRuns);
  await db.delete(agentEvalTestCases);
  await db.delete(agentEvalDatasets);
  await db.delete(agentEvalEnvironments);
  await db.delete(agentEvalBenchmarks);
  await db.delete(userConnectors);
  await db.delete(workspaces);
  await db.delete(users);
});

describe('dataset package import transaction', () => {
  it('stores an Environment-only connection, encrypted, in that Environment instead of a connector row', async () => {
    const input = params();
    input.package.connections = {
      private: {
        credentials: { token: 'synthetic-private-token', type: 'bearer' },
        name: 'Private mock',
        url: 'https://private.example/mcp',
      },
      unused: { name: 'Unused', url: 'https://unused.example/mcp' },
    };
    input.package.environments[0].connectionBindings = {
      notion: { connectionKey: 'private', transport: 'lobe-bench' },
    };
    await secureRepo.importPackage(input);
    await secureRepo.importPackage(input);
    expect(await db.select().from(userConnectors)).toHaveLength(0);
    const environments = await db.select().from(agentEvalEnvironments);
    expect(environments).toHaveLength(2);
    expect(environments[0].id).not.toBe(environments[1].id);
    for (const environment of environments) {
      expect(environment.config.mock?.services).toEqual(['notion']);
      expect(environment.config.connectorBindings?.notion).toEqual({
        connectorId: `env:${environment.id}:notion`,
        transport: 'lobe-bench',
      });
      const stored = environment.config.connections?.notion;
      expect(stored).toMatchObject({ name: 'Private mock', url: 'https://private.example/mcp' });
      expect(stored?.credentials).toBeTruthy();
      expect(stored?.credentials).not.toContain('synthetic-private-token');
    }
    const storedContent = JSON.stringify({
      cases: await db.select().from(agentEvalTestCases),
      datasets: await db.select().from(agentEvalDatasets),
      environments,
    });
    expect(storedContent).not.toContain('synthetic-private-token');
    expect(storedContent).not.toContain('unused.example');
  });

  it('refuses a package where a case binds its own connection', async () => {
    const input = params();
    input.package.connections = {
      direct: { name: 'Direct mock', url: 'https://direct.example/mcp' },
    };
    input.package.cases[0].connectionBindings = { notion: { connectionKey: 'direct' } };
    await expect(secureRepo.importPackage(input)).rejects.toThrow('belong to an Environment');
    expect(await db.select().from(agentEvalDatasets)).toHaveLength(0);
  });

  it('rolls back provisioned connections together with a failed dataset import', async () => {
    const input = params();
    input.package.connections = {
      private: { name: 'Private', url: 'https://private.example/mcp' },
    };
    input.package.environments[0].connectionBindings = { notion: { connectionKey: 'private' } };
    input.package.cases[0].environmentKey = 'missing';
    await expect(secureRepo.importPackage(input)).rejects.toBeInstanceOf(
      AgentEvalDatasetPackageImportError,
    );
    for (const table of [
      userConnectors,
      agentEvalBenchmarks,
      agentEvalDatasets,
      agentEvalEnvironments,
      agentEvalTestCases,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });

  it('refuses credential imports when encrypted storage cannot be initialized', async () => {
    const input = params();
    input.package.connections = {
      private: {
        credentials: { token: 'synthetic-private-token', type: 'bearer' },
        name: 'Private',
        url: 'https://private.example/mcp',
      },
    };
    input.package.environments[0].connectionBindings = { notion: { connectionKey: 'private' } };
    await expect(repo.importPackage(input)).rejects.toThrow(
      'Secure connection storage is unavailable',
    );
    expect(await db.select().from(userConnectors)).toHaveLength(0);
    expect(await db.select().from(agentEvalDatasets)).toHaveLength(0);
  });
  it('shares one environment across every case referencing the same package key', async () => {
    const shared = params();
    shared.package.cases.push({ ...shared.package.cases[0], key: 'two' });
    await repo.importPackage(shared);
    const environments = await db.select().from(agentEvalEnvironments);
    const cases = await db.select().from(agentEvalTestCases);
    expect(environments).toHaveLength(1);
    expect(cases).toHaveLength(2);
    expect(cases.every((testCase) => testCase.environmentId === environments[0].id)).toBe(true);
  });
  it('imports a dataset of its own, in no benchmark, with fresh environments on every import', async () => {
    const first = await repo.importPackage(params());
    const second = await repo.importPackage(params());
    expect(first.datasetId).not.toBe(second.datasetId);
    expect(first.benchmarkId).toBeNull();
    expect(await db.select().from(agentEvalBenchmarks)).toHaveLength(0);
    const datasets = await db.select().from(agentEvalDatasets);
    expect(datasets.map((dataset) => dataset.benchmarkId)).toEqual([null, null]);
    const cases = await db.select().from(agentEvalTestCases);
    expect(cases).toHaveLength(2);
    expect(cases[0].environmentId).not.toBe(cases[1].environmentId);
    expect(cases[0]).toMatchObject({
      userId,
      content: pack().cases[0].content,
      evalConfig: { expected: 'hello' },
      metadata: { caseId: 'one' },
    });
    const [environment] = await db
      .select()
      .from(agentEvalEnvironments)
      .where(eq(agentEvalEnvironments.id, cases[0].environmentId!));
    expect(environment).toMatchObject({
      userId,
      config: { memory: {} },
      metadata: { packageKey: 'world' },
    });
    const [dataset] = await db
      .select()
      .from(agentEvalDatasets)
      .where(eq(agentEvalDatasets.id, first.datasetId));
    expect(dataset).toMatchObject({
      userId,
      metadata: { custom: true, kind: 'lobe-bench', importedPackage: { sha256: params().sha256 } },
    });
  });

  it('rolls back the new benchmark, dataset and environments when a case cannot be linked', async () => {
    const invalid = params();
    invalid.package.cases[0].environmentKey = 'missing';
    await expect(repo.importPackage(invalid)).rejects.toBeInstanceOf(
      AgentEvalDatasetPackageImportError,
    );
    for (const table of [
      agentEvalBenchmarks,
      agentEvalDatasets,
      agentEvalEnvironments,
      agentEvalTestCases,
    ]) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });

  it('rejects foreign, system, workspace and non-LobeBench personal benchmarks', async () => {
    const rows = await db
      .insert(agentEvalBenchmarks)
      .values([
        {
          name: 'Foreign',
          identifier: 'foreign',
          userId: otherId,
          rubrics: [],
          metadata: { kind: 'lobe-bench' },
        },
        {
          name: 'System',
          identifier: 'system',
          userId: null,
          isSystem: true,
          rubrics: [],
          metadata: { kind: 'lobe-bench' },
        },
        {
          name: 'Workspace',
          identifier: 'workspace',
          userId,
          workspaceId,
          rubrics: [],
          metadata: { kind: 'lobe-bench' },
        },
        { name: 'Ordinary', identifier: 'ordinary', userId, rubrics: [] },
      ])
      .returning();
    for (const row of rows)
      await expect(repo.importPackage({ ...params(), benchmarkId: row.id })).rejects.toBeInstanceOf(
        AgentEvalDatasetWriteError,
      );
    expect(await db.select().from(agentEvalDatasets)).toEqual([]);
  });

  it('imports into a collaborator benchmark only in the current workspace', async () => {
    const [benchmark] = await db
      .insert(agentEvalBenchmarks)
      .values({
        name: 'Shared',
        identifier: 'shared',
        userId: otherId,
        workspaceId,
        isSystem: false,
        rubrics: [],
        metadata: { kind: 'lobe-bench' },
      })
      .returning();
    const result = await new AgentEvalDatasetPackageRepo(db, userId, workspaceId).importPackage({
      ...params(),
      benchmarkId: benchmark.id,
    });
    const [dataset] = await db
      .select()
      .from(agentEvalDatasets)
      .where(eq(agentEvalDatasets.id, result.datasetId));
    expect(dataset).toMatchObject({ userId, workspaceId, benchmarkId: benchmark.id });
    expect((await db.select().from(agentEvalEnvironments))[0]).toMatchObject({
      userId,
      workspaceId,
    });
  });

  it('accepts an empty ordinary dataset without changing its identity or turning it into LobeBench', async () => {
    const [dataset] = await db
      .insert(agentEvalDatasets)
      .values({
        name: 'Existing name',
        identifier: 'ordinary',
        userId,
        metadata: { customLabel: 'keep' },
      })
      .returning();
    const result = await repo.importPackage({ ...params(), datasetId: dataset.id });
    const [updated] = await db
      .select()
      .from(agentEvalDatasets)
      .where(eq(agentEvalDatasets.id, dataset.id));
    expect(result.datasetId).toBe(dataset.id);
    expect(updated.name).toBe('Existing name');
    expect(updated.metadata).toMatchObject({ customLabel: 'keep' });
    expect(updated.metadata?.kind).toBeUndefined();
    expect(await db.select().from(agentEvalBenchmarks)).toEqual([]);
  });

  it('rejects foreign, system, missing and cross-workspace datasets', async () => {
    const rows = await db
      .insert(agentEvalDatasets)
      .values([
        { name: 'Foreign', identifier: 'foreign', userId: otherId },
        { name: 'System', identifier: 'system', userId: null },
        { name: 'Workspace', identifier: 'workspace', userId, workspaceId },
      ])
      .returning();
    for (const id of [...rows.map((row) => row.id), 'missing'])
      await expect(repo.importPackage({ ...params(), datasetId: id })).rejects.toBeInstanceOf(
        AgentEvalDatasetWriteError,
      );
    expect(await db.select().from(agentEvalTestCases)).toEqual([]);
  });

  it('preserves existing cases including retired ones instead of replacing them', async () => {
    const imported = await repo.importPackage(params());
    await db.update(agentEvalTestCases).set({ metadata: { retired: true } });
    const before = await db.select().from(agentEvalTestCases);
    await expect(
      repo.importPackage({ ...params(), datasetId: imported.datasetId }),
    ).rejects.toBeInstanceOf(AgentEvalDatasetPackageImportError);
    expect(await db.select().from(agentEvalTestCases)).toEqual(before);
    expect(await db.select().from(agentEvalEnvironments)).toHaveLength(1);
  });

  it('refuses an empty dataset with historical runs without changing the run or dataset', async () => {
    const [dataset] = await db
      .insert(agentEvalDatasets)
      .values({ name: 'Historical', identifier: 'history', userId })
      .returning();
    await db
      .insert(agentEvalRuns)
      .values({ datasetId: dataset.id, userId, name: 'Historical run' });
    const before = await db.select().from(agentEvalRuns);
    await expect(repo.importPackage({ ...params(), datasetId: dataset.id })).rejects.toBeInstanceOf(
      AgentEvalDatasetPackageImportError,
    );
    expect(await db.select().from(agentEvalRuns)).toEqual(before);
    expect(await db.select().from(agentEvalDatasets)).toEqual([dataset]);
  });
});
