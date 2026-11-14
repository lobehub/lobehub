import type { EvalConnectorSnapshots, EvalRunConfig } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentEvalDatasets, agentEvalRuns, users, workspaces } from '../../../schemas';
import { AgentEvalRunModel } from '../run';

const db = await getTestDB();
const owner = 'run-projection-owner';
const otherOwner = 'run-projection-other-owner';
const workspaceId = 'run-projection-workspace';
const otherWorkspaceId = 'run-projection-other-workspace';
const model = new AgentEvalRunModel(db, owner);
const caseId = "case_'quoted/{key}";
let datasetId: string;

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: otherOwner }]);
  await db.insert(workspaces).values(
    [workspaceId, otherWorkspaceId].map((id) => ({
      id,
      name: id,
      primaryOwnerId: owner,
      slug: id,
    })),
  );
  const [dataset] = await db
    .insert(agentEvalDatasets)
    .values({ identifier: 'projection', name: 'Projection', userId: owner })
    .returning();
  datasetId = dataset.id;
});

afterEach(async () => {
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
  await db.delete(users).where(inArray(users.id, [owner, otherOwner]));
});

const caseSnapshots = (): EvalConnectorSnapshots => ({
  notion: {
    connectorId: '00000000-0000-4000-8000-000000000001',
    datasetId,
    fingerprint: 'sha256:original-contract-fingerprint',
    manifest: {
      api: [
        {
          description: 'Original detailed contract. '.repeat(2500),
          name: 'API-post-search',
          parameters: {
            additionalProperties: false,
            properties: {
              filter: {
                properties: { value: { enum: ['page', 'data_source'], type: 'string' } },
                required: ['value'],
                type: 'object',
              },
              query: { description: 'Unicode 查询 and exact spacing', type: 'string' },
            },
            required: ['query'],
            type: 'object',
          },
        },
      ],
      identifier: 'notion',
      meta: { description: 'Original Notion tools', title: 'Notion' },
      systemRole: 'Keep the original contract, including this instruction.',
      type: 'mcp',
    },
    transport: 'mcp',
  },
});

const baseConfig: EvalRunConfig = {
  caseSelection: { mode: 'all' },
  chatConfig: { reasoningEffort: 'high' },
  executionMode: 'internal',
  k: 3,
  maxSteps: 24,
  model: 'fixture-model',
  params: { frequency_penalty: 0, temperature: 0.35, top_p: 0.9 },
  provider: 'fixture-provider',
  unknownFutureOption: { enabled: false, value: null },
};

const readStored = async (id: string) => {
  const [run] = await db.select().from(agentEvalRuns).where(eq(agentEvalRuns.id, id));
  return run;
};

describe('AgentEvalRunModel SQL projections', () => {
  it('keeps the exact current-case frozen contract while 49 other cases do not increase its payload', async () => {
    const current = caseSnapshots();
    const run = await model.create({
      config: { ...baseConfig, connectorSnapshots: { [caseId]: current } },
      datasetId,
    });
    const single = await model.findForCase(run.id, caseId);
    const allSnapshots = Object.fromEntries([
      [caseId, current],
      ...Array.from({ length: 49 }, (_, index) => [`other-case-${index}`, caseSnapshots()]),
    ]);
    await model.update(run.id, { config: { ...baseConfig, connectorSnapshots: allSnapshots } });
    const storedBefore = await readStored(run.id);

    const projected = await model.findForCase(run.id, caseId);
    const full = await model.findById(run.id);

    expect(projected?.config).toEqual({ ...baseConfig, connectorSnapshots: { [caseId]: current } });
    expect(projected?.config).toEqual(single?.config);
    expect(Buffer.byteLength(JSON.stringify(projected?.config))).toBe(
      Buffer.byteLength(JSON.stringify(single?.config)),
    );
    expect(Buffer.byteLength(JSON.stringify(full?.config))).toBeGreaterThan(
      Buffer.byteLength(JSON.stringify(projected?.config)) * 45,
    );
    expect(projected).toEqual({ ...full, config: projected?.config });
    expect(full?.config?.connectorSnapshots).toEqual(allSnapshots);
    expect((await model.findSummaryById(run.id))?.config).toEqual(baseConfig);
    expect(await readStored(run.id)).toEqual(storedBefore);
  });

  it('returns compact detail and list summaries without changing complete findById or stored evidence', async () => {
    const config = { ...baseConfig, connectorSnapshots: { [caseId]: caseSnapshots() } };
    const run = await model.create({
      config,
      datasetId,
      metrics: { averageScore: 0, failedCases: 0, passRate: 0, passedCases: 0, totalCases: 1 },
      status: 'pending',
    });
    const storedBefore = await readStored(run.id);

    const summary = await model.findSummaryById(run.id);
    const listed = await model.query({ datasetId, limit: 1, status: 'pending' });
    const full = await model.findById(run.id);

    expect(summary).toEqual({ ...full, config: baseConfig });
    expect(summary?.hasUnverifiedAttempts).toBe(true);
    expect(listed).toEqual([summary]);
    expect(summary?.config).not.toHaveProperty('connectorSnapshots');
    expect(full?.config).toEqual(config);
    expect(await readStored(run.id)).toEqual(storedBefore);
  });

  it.each([
    { config: null, name: 'SQL null config' },
    { config: {}, name: 'empty config' },
    { config: baseConfig, name: 'missing snapshots' },
    {
      config: { ...baseConfig, connectorSnapshots: null } as unknown as EvalRunConfig,
      name: 'explicit null snapshots',
    },
    {
      config: { ...baseConfig, connectorSnapshots: { [caseId]: null } } as unknown as EvalRunConfig,
      name: 'explicit null case contract',
    },
    {
      config: {
        ...baseConfig,
        connectorSnapshots: {
          [caseId]: { notion: { connectorId: 'legacy-connection', fingerprint: 'legacy' } },
        },
      },
      name: 'legacy snapshot missing manifest and dataset ownership',
    },
  ])('preserves $name without inventing an execution contract', async ({ config }) => {
    const run = await model.create({ config, datasetId });
    const storedBefore = await readStored(run.id);
    expect((await model.findForCase(run.id, caseId))?.config).toEqual(config);
    const { connectorSnapshots: _snapshots, ...expectedSummary } = config ?? {};
    expect((await model.findSummaryById(run.id))?.config).toEqual(
      config === null ? null : expectedSummary,
    );
    expect(await readStored(run.id)).toEqual(storedBefore);
  });

  it('does not substitute another case when the requested snapshot is absent', async () => {
    const run = await model.create({
      config: { ...baseConfig, connectorSnapshots: { other: caseSnapshots() } },
      datasetId,
    });
    const storedBefore = await readStored(run.id);
    expect((await model.findForCase(run.id, caseId))?.config).toEqual({
      ...baseConfig,
      connectorSnapshots: {},
    });
    expect(await readStored(run.id)).toEqual(storedBefore);
  });

  it('retains personal owner and workspace boundaries for both new reads and list summaries', async () => {
    const config = { ...baseConfig, connectorSnapshots: { [caseId]: caseSnapshots() } };
    const personal = await model.create({ config, datasetId });
    const workspaceModel = new AgentEvalRunModel(db, owner, workspaceId);
    const team = await workspaceModel.create({ config, datasetId });
    const otherUserModel = new AgentEvalRunModel(db, otherOwner);
    const otherTeamModel = new AgentEvalRunModel(db, owner, otherWorkspaceId);

    for (const [reader, hiddenId] of [
      [otherUserModel, personal.id],
      [model, team.id],
      [workspaceModel, personal.id],
      [otherTeamModel, team.id],
    ] as const) {
      expect(await reader.findForCase(hiddenId, caseId)).toBeUndefined();
      expect(await reader.findSummaryById(hiddenId)).toBeUndefined();
    }
    expect(await model.findForCase('missing-run', caseId)).toBeUndefined();
    expect(await model.findSummaryById('missing-run')).toBeUndefined();
    expect(await otherUserModel.query()).toEqual([]);
    expect(await otherTeamModel.query()).toEqual([]);
    expect((await model.query()).map(({ id }) => id)).toEqual([personal.id]);
    expect((await workspaceModel.query()).map(({ id }) => id)).toEqual([team.id]);
    expect((await workspaceModel.findForCase(team.id, caseId))?.config).toEqual(config);
    expect((await workspaceModel.findSummaryById(team.id))?.config).toEqual(baseConfig);
    // Existing workspace semantics allow another member to read shared runs.
    const member = new AgentEvalRunModel(db, otherOwner, workspaceId);
    expect((await member.findForCase(team.id, caseId))?.config).toEqual(config);
    expect((await member.findSummaryById(team.id))?.config).toEqual(baseConfig);
  });
});
