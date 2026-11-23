// @vitest-environment node
import { promisify } from 'node:util';
import { zstdCompress } from 'node:zlib';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  agentEvalDatasets,
  agentEvalReplayResults,
  agentEvalRuns,
  agentEvalTestCases,
  agentOperations,
  messages,
  topics,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalRouter } from '../../agentEval';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

const compressZstd = promisify(zstdCompress);

const { s3Objects } = vi.hoisted(() => ({ s3Objects: new Map<string, Uint8Array>() }));
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(function () {
    return {
      getFileByteArray: vi.fn(async (key: string) => {
        const body = s3Objects.get(key);
        if (!body) throw new Error('NoSuchKey');
        return body;
      }),
      uploadBuffer: vi.fn(async (key: string, body: Buffer) => {
        s3Objects.set(key, new Uint8Array(body));
      }),
    };
  }),
}));

vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));

const { triggerReplayCell, triggerRunBenchmark } = vi.hoisted(() => ({
  triggerReplayCell: vi.fn().mockResolvedValue({}),
  triggerRunBenchmark: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerReplayCell, triggerRunBenchmark },
}));

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const CRITERIA = 'The user is Arvin; the pasted text was written by a third party.';

describe('agentEval replay comparison router', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let otherUserId: string;
  let datasetId: string;
  let messageId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    s3Objects.clear();
    triggerReplayCell.mockClear();
    triggerRunBenchmark.mockClear();

    await serverDB.delete(agentEvalReplayResults);
    await serverDB.delete(agentEvalRuns);
    await serverDB.delete(agentEvalTestCases);
    await serverDB.delete(agentEvalDatasets);
    await serverDB.delete(agentOperations);

    userId = await createTestUser(serverDB);
    otherUserId = await createTestUser(serverDB);

    const [topic] = await serverDB.insert(topics).values({ title: 'src', userId }).returning();
    const operationId = `op_1_agt_x_${topic.id}_abc`;
    const traceKey = `agent-traces/agt_x/${topic.id}/${operationId}.json.zst`;
    const [message] = await serverDB
      .insert(messages)
      .values({
        content: 'wrong',
        metadata: { operationId },
        role: 'assistant',
        topicId: topic.id,
        userId,
      })
      .returning();
    messageId = message.id;
    await serverDB
      .insert(agentOperations)
      .values({ id: operationId, status: 'done', topicId: topic.id, traceS3Key: traceKey, userId });
    s3Objects.set(
      traceKey,
      new Uint8Array(
        await compressZstd(
          Buffer.from(
            JSON.stringify({
              operationId,
              steps: [
                {
                  contextEngine: { output: [{ content: 'who am I?', role: 'user' }] },
                  stepIndex: 0,
                  stepType: 'call_llm',
                },
              ],
            }),
          ),
        ),
      ),
    );

    const [dataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'bad-cases', name: 'Bad cases', userId })
      .returning();
    datasetId = dataset.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    await cleanupTestUser(serverDB, otherUserId);
  });

  const targets = [
    { model: 'deepseek-v4-flash', provider: 'deepseek' },
    { model: 'claude-sonnet-5-5', provider: 'anthropic' },
  ];
  const judge = { model: 'claude-haiku-4-5', provider: 'anthropic' };

  it('freezes, starts a comparison and reads the grid back', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    const { created, testCase } = await caller.freezeTestCaseFromMessage({
      criteria: CRITERIA,
      datasetId,
      messageId,
    });
    expect(created).toBe(true);

    const fetched = await caller.getTestCase({ id: testCase.id });
    expect(fetched).toMatchObject({ sourceMessageId: messageId, frozenStepIndex: 0 });

    const { cellCount, runId } = await caller.startReplayComparison({ datasetId, judge, targets });
    expect(cellCount).toBe(2);
    expect(triggerReplayCell).toHaveBeenCalledTimes(2);

    const comparison = await caller.getReplayComparison({ runId });
    expect(comparison.targets).toEqual(targets);
    expect(comparison.cells.map((c) => c.status)).toEqual(['pending', 'pending']);
    expect(comparison.judge).toEqual(judge);

    const history = await caller.listReplayComparisonsByTestCase({ testCaseId: testCase.id });
    expect(history.map((h) => h.run.id)).toEqual([runId]);
  });

  it('validates the input contract', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));

    await expect(
      caller.freezeTestCaseFromMessage({ criteria: '   ', datasetId, messageId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.startReplayComparison({ datasetId, targets: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.startReplayComparison({
        datasetId,
        targets: Array.from({ length: 9 }, (_, i) => ({ model: `m${i}`, provider: 'p' })),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('isolates comparisons between users', async () => {
    const owner = agentEvalRouter.createCaller(createTestContext(userId));
    const stranger = agentEvalRouter.createCaller(createTestContext(otherUserId));
    await owner.freezeTestCaseFromMessage({ criteria: CRITERIA, datasetId, messageId });
    const { runId } = await owner.startReplayComparison({ datasetId, judge, targets });

    await expect(stranger.getReplayComparison({ runId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(stranger.startReplayComparison({ datasetId, targets })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      stranger.freezeTestCaseFromMessage({ criteria: CRITERIA, datasetId, messageId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to start a replay run through the agent-run entry point', async () => {
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    await caller.freezeTestCaseFromMessage({ criteria: CRITERIA, datasetId, messageId });
    const { runId } = await caller.startReplayComparison({ datasetId, judge, targets });

    await expect(caller.startRun({ id: runId })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(triggerRunBenchmark).not.toHaveBeenCalled();
  });
});
