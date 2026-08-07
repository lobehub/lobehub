// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalRuns,
  agentEvalRunTopics,
  agentEvalTestCases,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '../agentEval';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-eval-workspace-user';
const workspaceId = 'agent-eval-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Agent Eval Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('Agent eval workspace scope', () => {
  it('isolates benchmarks, datasets, test cases, runs, and run topics', async () => {
    const personalBenchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId);
    const workspaceBenchmarkModel = new AgentEvalBenchmarkModel(serverDB, userId, workspaceId);
    const personalDatasetModel = new AgentEvalDatasetModel(serverDB, userId);
    const workspaceDatasetModel = new AgentEvalDatasetModel(serverDB, userId, workspaceId);
    const personalTestCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
    const workspaceTestCaseModel = new AgentEvalTestCaseModel(serverDB, userId, workspaceId);
    const personalRunModel = new AgentEvalRunModel(serverDB, userId);
    const workspaceRunModel = new AgentEvalRunModel(serverDB, userId, workspaceId);
    const personalRunTopicModel = new AgentEvalRunTopicModel(serverDB, userId);
    const workspaceRunTopicModel = new AgentEvalRunTopicModel(serverDB, userId, workspaceId);

    const personalBenchmark = await personalBenchmarkModel.create({
      identifier: 'shared-benchmark',
      isSystem: false,
      name: 'Personal benchmark',
      rubrics: [],
    });
    const workspaceBenchmark = await workspaceBenchmarkModel.create({
      identifier: 'shared-benchmark',
      isSystem: false,
      name: 'Workspace benchmark',
      rubrics: [],
    });

    await expect(
      personalBenchmarkModel.findByIdentifier('shared-benchmark'),
    ).resolves.toMatchObject({
      id: personalBenchmark.id,
      workspaceId: null,
    });
    await expect(
      workspaceBenchmarkModel.findByIdentifier('shared-benchmark'),
    ).resolves.toMatchObject({
      id: workspaceBenchmark.id,
      workspaceId,
    });

    const personalDataset = await personalDatasetModel.create({
      benchmarkId: personalBenchmark.id,
      identifier: 'shared-dataset',
      name: 'Personal dataset',
    });
    const workspaceDataset = await workspaceDatasetModel.create({
      benchmarkId: workspaceBenchmark.id,
      identifier: 'shared-dataset',
      name: 'Workspace dataset',
    });

    await expect(
      personalDatasetModel.query({ benchmarkId: personalBenchmark.id }),
    ).resolves.toEqual([expect.objectContaining({ id: personalDataset.id })]);
    await expect(
      workspaceDatasetModel.query({ benchmarkId: workspaceBenchmark.id }),
    ).resolves.toEqual([expect.objectContaining({ id: workspaceDataset.id })]);
    await expect(personalDatasetModel.findById(personalDataset.id)).resolves.toMatchObject({
      id: personalDataset.id,
      workspaceId: null,
    });
    await expect(workspaceDatasetModel.findById(workspaceDataset.id)).resolves.toMatchObject({
      id: workspaceDataset.id,
      workspaceId,
    });

    const personalTestCase = await personalTestCaseModel.create({
      content: { expected: 'personal', input: 'question' },
      datasetId: personalDataset.id,
    });
    const workspaceTestCase = await workspaceTestCaseModel.create({
      content: { expected: 'workspace', input: 'question' },
      datasetId: workspaceDataset.id,
    });

    await expect(personalTestCaseModel.findById(workspaceTestCase.id)).resolves.toBeUndefined();
    await expect(workspaceTestCaseModel.findById(personalTestCase.id)).resolves.toBeUndefined();

    const personalRun = await personalRunModel.create({
      datasetId: personalDataset.id,
      name: 'Personal run',
    });
    const workspaceRun = await workspaceRunModel.create({
      datasetId: workspaceDataset.id,
      name: 'Workspace run',
    });

    await expect(personalRunModel.findById(workspaceRun.id)).resolves.toBeUndefined();
    await expect(workspaceRunModel.findById(personalRun.id)).resolves.toBeUndefined();

    await serverDB.insert(topics).values([
      { id: 'agent-eval-personal-topic', title: 'Personal topic', userId, workspaceId: null },
      { id: 'agent-eval-workspace-topic', title: 'Workspace topic', userId, workspaceId },
    ]);

    await personalRunTopicModel.batchCreate([
      {
        runId: personalRun.id,
        status: 'completed',
        testCaseId: personalTestCase.id,
        topicId: 'agent-eval-personal-topic',
      },
    ]);
    const [workspaceRunTopic] = await workspaceRunTopicModel.batchCreate([
      {
        runId: workspaceRun.id,
        status: 'completed',
        testCaseId: workspaceTestCase.id,
        topicId: 'agent-eval-workspace-topic',
      },
    ]);

    expect(workspaceRunTopic).toMatchObject({ runId: workspaceRun.id, workspaceId });

    await expect(personalRunTopicModel.findByRunId(workspaceRun.id)).resolves.toEqual([]);
    await expect(workspaceRunTopicModel.findByRunId(personalRun.id)).resolves.toEqual([]);
    await expect(workspaceRunTopicModel.findByRunId(workspaceRun.id)).resolves.toEqual([
      expect.objectContaining({
        runId: workspaceRun.id,
        topicId: 'agent-eval-workspace-topic',
      }),
    ]);

    await personalBenchmarkModel.delete(personalBenchmark.id);

    await expect(personalBenchmarkModel.findById(personalBenchmark.id)).resolves.toBeUndefined();
    await expect(workspaceBenchmarkModel.findById(workspaceBenchmark.id)).resolves.toMatchObject({
      id: workspaceBenchmark.id,
      workspaceId,
    });
  });
});

afterEach(async () => {
  await serverDB.delete(agentEvalRunTopics).where(eq(agentEvalRunTopics.userId, userId));
  await serverDB.delete(topics).where(eq(topics.userId, userId));
  await serverDB.delete(agentEvalRuns).where(eq(agentEvalRuns.userId, userId));
  await serverDB.delete(agentEvalTestCases).where(eq(agentEvalTestCases.userId, userId));
  await serverDB.delete(agentEvalDatasets).where(eq(agentEvalDatasets.userId, userId));
  await serverDB.delete(agentEvalBenchmarks).where(eq(agentEvalBenchmarks.userId, userId));
});
