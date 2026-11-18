// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  agents,
  topics,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalRouter } from '../../agentEval';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => serverDB),
}));

describe('Agent Eval run creation validation', () => {
  let userId: string;
  let otherUserId: string;
  let benchmarkId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    await serverDB.delete(agentEvalRunTopics);
    await serverDB.delete(topics);
    await serverDB.delete(agentEvalRuns);
    await serverDB.delete(agentEvalTestCases);
    await serverDB.delete(agentEvalDatasets);
    await serverDB.delete(agentEvalBenchmarks);
    userId = await createTestUser(serverDB);
    otherUserId = await createTestUser(serverDB);
    const [benchmark] = await serverDB
      .insert(agentEvalBenchmarks)
      .values({ identifier: 'create-run-validation', isSystem: false, name: 'Cases', rubrics: [] })
      .returning();
    benchmarkId = benchmark.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, otherUserId);
    await cleanupTestUser(serverDB, userId);
  });

  const createDataset = async (ownerId: string | null, withCase = false, workspaceId?: string) => {
    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ benchmarkId, identifier: 'cases', name: 'Cases', userId: ownerId, workspaceId })
      .returning();
    if (withCase) {
      await serverDB.insert(agentEvalTestCases).values({
        content: { input: 'A plain case' },
        datasetId: dataset.id,
        metadata: { caseId: 'case-1' },
        userId: ownerId,
        workspaceId,
      });
    }
    return dataset;
  };

  const expectNoRunArtifacts = async () => {
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(0);
    expect(await serverDB.select().from(agentEvalRunTopics)).toHaveLength(0);
    expect(await serverDB.select().from(topics)).toHaveLength(0);
    expect(await serverDB.select().from(agents).where(eq(agents.virtual, true))).toHaveLength(0);
  };

  it.each(['internal', 'external'] as const)(
    'rejects a missing dataset with BAD_REQUEST before creating an %s run',
    async (mode) => {
      const caller = agentEvalRouter.createCaller(createTestContext(userId));

      await expect(caller.createRun({ datasetId: 'missing-dataset', mode })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Dataset not found',
      });
      await expectNoRunArtifacts();
    },
  );

  it.each(['internal', 'external'] as const)(
    'returns the same not-found error for an inaccessible dataset in %s mode',
    async (mode) => {
      const dataset = await createDataset(otherUserId, true);
      const caller = agentEvalRouter.createCaller(createTestContext(userId));

      await expect(caller.createRun({ datasetId: dataset.id, mode })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Dataset not found',
      });
      await expectNoRunArtifacts();
    },
  );

  it('rejects an empty internal dataset without creating run artifacts', async () => {
    const dataset = await createDataset(userId);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    await expect(caller.createRun({ datasetId: dataset.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Select at least one test case',
    });
    await expectNoRunArtifacts();
  });

  it('rejects an excluded-all internal selection without creating run artifacts', async () => {
    const dataset = await createDataset(userId, true);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    await expect(
      caller.createRun({
        config: { caseSelection: { caseIds: ['case-1'], mode: 'exclude' } },
        datasetId: dataset.id,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Select at least one test case',
    });
    await expectNoRunArtifacts();
  });

  it('pre-creates pending topics for a nonempty internal dataset', async () => {
    const dataset = await createDataset(userId, true);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    const run = await caller.createRun({ datasetId: dataset.id });

    expect(run.status).toBe('idle');
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(1);
    expect(await serverDB.select().from(agentEvalRunTopics)).toMatchObject([
      { runId: run.id, status: 'pending' },
    ]);
    expect(await serverDB.select().from(topics)).toMatchObject([{ trigger: 'eval', userId }]);
  });

  it('allows an empty external dataset and leaves the run pending without topics', async () => {
    const dataset = await createDataset(userId);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    const run = await caller.createRun({ datasetId: dataset.id, mode: 'external' });

    expect(run.status).toBe('pending');
    expect(run.config).toMatchObject({ executionMode: 'external' });
    expect(await serverDB.select().from(agentEvalRuns)).toHaveLength(1);
    expect(await serverDB.select().from(agentEvalRunTopics)).toHaveLength(0);
    expect(await serverDB.select().from(topics)).toHaveLength(0);
    expect(await serverDB.select().from(agents).where(eq(agents.virtual, true))).toHaveLength(0);
  });

  it('allows a readable system dataset without claiming its ownership', async () => {
    const dataset = await createDataset(null, true);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    const run = await caller.createRun({ datasetId: dataset.id });

    expect(run).toMatchObject({ datasetId: dataset.id, status: 'idle', userId });
    expect(await serverDB.select().from(agentEvalRunTopics)).toMatchObject([
      { runId: run.id, status: 'pending', userId },
    ]);
    expect(await serverDB.select().from(agentEvalDatasets)).toMatchObject([
      { id: dataset.id, userId: null },
    ]);
  });

  it("allows a workspace collaborator to run another member's dataset", async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Shared cases', primaryOwnerId: otherUserId, slug: `cases-${otherUserId}` })
      .returning();
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: otherUserId, workspaceId: workspace.id },
      { role: 'member', userId, workspaceId: workspace.id },
    ]);
    const dataset = await createDataset(otherUserId, true, workspace.id);
    const caller = agentEvalRouter.createCaller({
      ...createTestContext(userId),
      workspaceId: workspace.id,
    });

    const run = await caller.createRun({ datasetId: dataset.id });

    expect(run).toMatchObject({
      datasetId: dataset.id,
      status: 'idle',
      userId,
      workspaceId: workspace.id,
    });
    expect(await serverDB.select().from(agentEvalRunTopics)).toMatchObject([
      { runId: run.id, status: 'pending', userId, workspaceId: workspace.id },
    ]);
    expect(await serverDB.select().from(agentEvalDatasets)).toMatchObject([
      { id: dataset.id, userId: otherUserId, workspaceId: workspace.id },
    ]);
  });
});
