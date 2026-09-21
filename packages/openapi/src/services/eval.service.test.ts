// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { EvalService } from './eval.service';

const {
  datasetCountMock,
  datasetFindByIdMock,
  datasetQueryListMock,
  runCountMock,
  runFindByIdMock,
  runQueryMock,
  runTopicCountByRunIdMock,
  runTopicFindByRunIdMock,
} = vi.hoisted(() => ({
  datasetCountMock: vi.fn(),
  datasetFindByIdMock: vi.fn(),
  datasetQueryListMock: vi.fn(),
  runCountMock: vi.fn(),
  runFindByIdMock: vi.fn(),
  runQueryMock: vi.fn(),
  runTopicCountByRunIdMock: vi.fn(),
  runTopicFindByRunIdMock: vi.fn(),
}));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('@/database/schemas', () => ({
  agents: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/database/models/agentEval', () => ({
  AgentEvalDatasetModel: class {
    count = datasetCountMock;
    findById = datasetFindByIdMock;
    queryList = datasetQueryListMock;
  },
  AgentEvalRunModel: class {
    count = runCountMock;
    findById = runFindByIdMock;
    query = runQueryMock;
  },
  AgentEvalRunTopicModel: class {
    countByRunId = runTopicCountByRunIdMock;
    findByRunId = runTopicFindByRunIdMock;
  },
}));
vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: class {},
  RUN_CREATE_ID_CONFLICT: 'RUN_CREATE_ID_CONFLICT',
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerRunBenchmark: vi.fn() },
}));

const now = new Date('2026-01-01T00:00:00Z');

const runRow = {
  clientId: 'internal-client',
  config: { k: 1 },
  createdAt: now,
  datasetId: 'ds-1',
  experimentId: null,
  id: 'run-1',
  metrics: null,
  name: 'run one',
  parentRunId: null,
  startedAt: null,
  status: 'completed',
  targetAgentId: 'agent-1',
  updatedAt: now,
  userId: 'user-1',
  workspaceId: 'ws-1',
};

const datasetRow = {
  benchmarkId: 'bm-1',
  createdAt: now,
  description: null,
  evalConfig: null,
  evalMode: null,
  id: 'ds-1',
  identifier: 'my-dataset',
  metadata: null,
  name: 'dataset one',
  sourceExperimentId: null,
  updatedAt: now,
  userId: 'user-1',
  workspaceId: null,
};

const service = () => new EvalService({} as LobeChatDatabase, 'user-1', 'ws-1');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EvalService.listRuns', () => {
  it('translates page/pageSize into limit/offset and forwards filters', async () => {
    runQueryMock.mockResolvedValue([]);
    runCountMock.mockResolvedValue(0);

    await service().listRuns({ datasetId: 'ds-1', page: 3, pageSize: 5, status: 'completed' });

    expect(runQueryMock).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      limit: 5,
      offset: 10,
      status: 'completed',
    });
    expect(runCountMock).toHaveBeenCalledWith({ datasetId: 'ds-1', status: 'completed' });
  });

  it('returns projected runs without internal columns, plus total', async () => {
    runQueryMock.mockResolvedValue([runRow]);
    runCountMock.mockResolvedValue(42);

    const result = await service().listRuns({});

    expect(result.total).toBe(42);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).not.toHaveProperty('userId');
    expect(result.runs[0]).not.toHaveProperty('workspaceId');
    expect(result.runs[0]).not.toHaveProperty('clientId');
    expect(result.runs[0]).toMatchObject({ datasetId: 'ds-1', id: 'run-1', status: 'completed' });
  });
});

describe('EvalService.listDatasets', () => {
  it('applies default pagination (page 1 / 20 items)', async () => {
    datasetQueryListMock.mockResolvedValue([]);
    datasetCountMock.mockResolvedValue(0);

    await service().listDatasets({});

    expect(datasetQueryListMock).toHaveBeenCalledWith({
      benchmarkId: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it('returns projected datasets without internal columns', async () => {
    datasetQueryListMock.mockResolvedValue([datasetRow]);
    datasetCountMock.mockResolvedValue(1);

    const result = await service().listDatasets({ page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.datasets[0]).not.toHaveProperty('userId');
    expect(result.datasets[0]).not.toHaveProperty('workspaceId');
    expect(result.datasets[0]).toMatchObject({ id: 'ds-1', identifier: 'my-dataset' });
  });
});

describe('EvalService.getDataset', () => {
  it('throws NotFoundError when the dataset belongs to someone else (model filters it out)', async () => {
    datasetFindByIdMock.mockResolvedValue(undefined);

    await expect(service().getDataset('ds-other')).rejects.toMatchObject({
      message: 'Eval dataset not found',
      name: 'NotFoundError',
    });
  });

  it('projects the dataset and its test cases', async () => {
    datasetFindByIdMock.mockResolvedValue({
      ...datasetRow,
      testCases: [
        {
          content: { input: 'q1' },
          createdAt: now,
          datasetId: 'ds-1',
          evalConfig: null,
          evalMode: null,
          id: 'tc-1',
          metadata: null,
          sortOrder: 1,
          updatedAt: now,
          userId: 'user-1',
          workspaceId: null,
        },
      ],
    });

    const result = await service().getDataset('ds-1');

    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('workspaceId');
    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0]).not.toHaveProperty('userId');
    expect(result.testCases[0]).not.toHaveProperty('workspaceId');
    expect(result.testCases[0]).toMatchObject({ content: { input: 'q1' }, id: 'tc-1' });
  });
});

describe('EvalService.getRunTopics', () => {
  it('throws NotFoundError for a run owned by someone else, before touching topics', async () => {
    runFindByIdMock.mockResolvedValue(undefined);

    await expect(service().getRunTopics('run-other', {})).rejects.toMatchObject({
      message: 'Eval run not found',
      name: 'NotFoundError',
    });
    expect(runTopicFindByRunIdMock).not.toHaveBeenCalled();
  });

  it('paginates and projects run topics without internal columns', async () => {
    runFindByIdMock.mockResolvedValue(runRow);
    runTopicFindByRunIdMock.mockResolvedValue([
      {
        createdAt: now,
        evalResult: { passAtK: true },
        passed: true,
        runId: 'run-1',
        score: 0.9,
        status: 'passed',
        testCase: { content: { input: 'q1' }, id: 'tc-1' },
        testCaseId: 'tc-1',
        topic: { id: 'topic-1' },
        topicId: 'topic-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      },
    ]);
    runTopicCountByRunIdMock.mockResolvedValue(7);

    const result = await service().getRunTopics('run-1', { page: 2, pageSize: 3 });

    expect(runTopicFindByRunIdMock).toHaveBeenCalledWith('run-1', { limit: 3, offset: 3 });
    expect(result.runId).toBe('run-1');
    expect(result.total).toBe(7);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]).not.toHaveProperty('userId');
    expect(result.topics[0]).not.toHaveProperty('workspaceId');
    expect(result.topics[0]).not.toHaveProperty('testCase');
    expect(result.topics[0]).not.toHaveProperty('topic');
    expect(result.topics[0]).toMatchObject({
      input: 'q1',
      passed: true,
      testCaseId: 'tc-1',
      topicId: 'topic-1',
    });
  });
});
