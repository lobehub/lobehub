import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentEvalDatasets,
  agentEvalReplayResults,
  agentEvalRuns,
  agentEvalTestCases,
  messages,
  topics,
  users,
} from '../../../schemas';
import { AgentEvalReplayResultModel } from '../replayResult';
import { AgentEvalTestCaseModel } from '../testCase';

const serverDB = await getTestDB();

const userId = 'replay-result-test-user';
const otherUserId = 'replay-result-other-user';
const model = new AgentEvalReplayResultModel(serverDB, userId);

const targets = [
  { model: 'deepseek-v4-flash', provider: 'deepseek' },
  { model: 'gpt-6-luna', provider: 'openai' },
];

let datasetId: string;
let runId: string;
let caseIds: string[];

const cleanup = async () => {
  await serverDB.delete(agentEvalReplayResults);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ identifier: 'replay-ds', name: 'Replay', userId })
    .returning();
  datasetId = dataset.id;

  const cases = await serverDB
    .insert(agentEvalTestCases)
    .values([
      { content: { input: 'q1' }, datasetId, sortOrder: 1, userId },
      { content: { input: 'q2' }, datasetId, sortOrder: 2, userId },
    ])
    .returning();
  caseIds = cases.map((c) => c.id);

  const [run] = await serverDB
    .insert(agentEvalRuns)
    .values({ config: { executionMode: 'replay', replayTargets: targets }, datasetId, userId })
    .returning();
  runId = run.id;
});

afterEach(cleanup);

describe('AgentEvalReplayResultModel', () => {
  describe('seedPending', () => {
    it('creates one pending cell per case × target', async () => {
      const rows = await model.seedPending(runId, caseIds, targets);

      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.status === 'pending')).toBe(true);
      expect(rows.every((row) => row.id.startsWith('rpl_'))).toBe(true);
      expect(new Set(rows.map((r) => `${r.testCaseId}:${r.provider}/${r.model}`)).size).toBe(4);
    });

    it('is idempotent: re-seeding keeps finished cells and inserts nothing', async () => {
      const [first] = await model.seedPending(runId, caseIds, targets);
      await model.update(first.id, { score: 0.9, status: 'completed' });

      const reseeded = await model.seedPending(runId, caseIds, targets);

      expect(reseeded).toHaveLength(0);
      const after = await model.findById(first.id);
      expect(after?.status).toBe('completed');
      expect(after?.score).toBeCloseTo(0.9);
    });

    it('returns empty without touching the table for empty inputs', async () => {
      expect(await model.seedPending(runId, [], targets)).toEqual([]);
      expect(await model.seedPending(runId, caseIds, [])).toEqual([]);
    });

    it('rejects a duplicate cell at the database level', async () => {
      await model.seedPending(runId, caseIds, targets);

      await expect(
        serverDB.insert(agentEvalReplayResults).values({
          model: targets[0].model,
          provider: targets[0].provider,
          runId,
          testCaseId: caseIds[0],
          userId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('claim', () => {
    it('moves a pending cell to running exactly once', async () => {
      const [cell] = await model.seedPending(runId, caseIds, targets);

      const claimed = await model.claim(cell.id);
      const again = await model.claim(cell.id);

      expect(claimed?.status).toBe('running');
      expect(again).toBeUndefined();
    });
  });

  describe('persistence and query', () => {
    it('stores the replay output and judge verdict and reads them back by run', async () => {
      const [cell] = await model.seedPending(runId, [caseIds[0]], [targets[0]]);

      await model.update(cell.id, {
        content: 'Arvin, here are the action items…',
        durationMs: 1234,
        judgeReason: 'Treats the user as Arvin',
        passed: true,
        score: 0.85,
        status: 'completed',
        toolCalls: [{ arguments: '{}', name: 'search' }],
        usage: { completionTokens: 10, promptTokens: 100, totalTokens: 110 },
      });

      const [row] = await model.findByRunId(runId);
      expect(row).toMatchObject({
        content: 'Arvin, here are the action items…',
        durationMs: 1234,
        judgeReason: 'Treats the user as Arvin',
        passed: true,
        status: 'completed',
        toolCalls: [{ arguments: '{}', name: 'search' }],
        usage: { completionTokens: 10, promptTokens: 100, totalTokens: 110 },
      });
      expect(row.score).toBeCloseTo(0.85);
    });

    it('lists a test case’s cells across runs together with the run', async () => {
      await model.seedPending(runId, caseIds, targets);

      const rows = await model.findByTestCaseId(caseIds[0]);

      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.cell.testCaseId === caseIds[0])).toBe(true);
      expect(rows[0].run.id).toBe(runId);
    });

    it('counts unfinished cells and resets errored ones', async () => {
      const cells = await model.seedPending(runId, caseIds, targets);
      await model.update(cells[0].id, { status: 'completed' });
      await model.update(cells[1].id, {
        error: { message: 'boom', stage: 'replay' },
        status: 'error',
      });

      expect(await model.countUnfinished(runId)).toBe(2);

      const reset = await model.resetErrored(runId);
      expect(reset).toHaveLength(1);
      expect(reset[0]).toMatchObject({ error: null, status: 'pending' });
      expect(await model.countUnfinished(runId)).toBe(3);
    });

    it('cascades cells away when the run is deleted', async () => {
      await model.seedPending(runId, caseIds, targets);
      await serverDB.delete(agentEvalRuns).where(eq(agentEvalRuns.id, runId));

      expect(await model.findByRunId(runId)).toHaveLength(0);
    });
  });

  describe('ownership', () => {
    it('hides another user’s cells from every read and write', async () => {
      const [cell] = await model.seedPending(runId, caseIds, targets);
      const stranger = new AgentEvalReplayResultModel(serverDB, otherUserId);

      expect(await stranger.findById(cell.id)).toBeUndefined();
      expect(await stranger.findByRunId(runId)).toHaveLength(0);
      expect(await stranger.findByTestCaseId(caseIds[0])).toHaveLength(0);
      expect(await stranger.claim(cell.id)).toBeUndefined();
      expect(await stranger.update(cell.id, { score: 1 })).toBeUndefined();
      expect(await stranger.countUnfinished(runId)).toBe(0);
    });
  });
});

describe('AgentEvalTestCaseModel provenance', () => {
  it('stores source columns and finds a case by its source message', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    const [message] = await serverDB
      .insert(messages)
      .values({ content: 'wrong answer', role: 'assistant', topicId: topic.id, userId })
      .returning();

    const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
    const created = await testCaseModel.create({
      content: { input: 'who am I?' },
      datasetId,
      frozenCall: { frozenAt: '2026-10-07T00:00:00.000Z', messages: [], stepIndex: 1 },
      frozenStepIndex: 1,
      sourceMessageId: message.id,
      sourceOperationId: 'op_1',
      sourceTopicId: topic.id,
    });

    const found = await testCaseModel.findByDatasetIdAndSourceMessageId(datasetId, message.id);
    expect(found?.id).toBe(created.id);
    expect(found).toMatchObject({
      frozenCall: { frozenAt: '2026-10-07T00:00:00.000Z', messages: [], stepIndex: 1 },
      frozenStepIndex: 1,
      sourceOperationId: 'op_1',
      sourceTopicId: topic.id,
    });

    const stranger = new AgentEvalTestCaseModel(serverDB, otherUserId);
    expect(await stranger.findByDatasetIdAndSourceMessageId(datasetId, message.id)).toBeUndefined();
  });

  it('keeps the case (and its inline frozen call) when the source message is deleted', async () => {
    const [topic] = await serverDB.insert(topics).values({ title: 't', userId }).returning();
    const [message] = await serverDB
      .insert(messages)
      .values({ content: 'x', role: 'assistant', topicId: topic.id, userId })
      .returning();
    const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
    const created = await testCaseModel.create({
      content: { input: 'q' },
      datasetId,
      frozenCall: {
        frozenAt: '2026-10-07T00:00:00.000Z',
        messages: [{ role: 'user' }],
        stepIndex: 0,
      },
      sourceMessageId: message.id,
      sourceTopicId: topic.id,
    });

    await serverDB.delete(messages).where(eq(messages.id, message.id));
    await serverDB.delete(topics).where(eq(topics.id, topic.id));

    const after = await testCaseModel.findById(created.id);
    expect(after).toMatchObject({
      frozenCall: { messages: [{ role: 'user' }], stepIndex: 0 },
      sourceMessageId: null,
      sourceTopicId: null,
    });
  });

  it('findByIds returns only the caller’s cases', async () => {
    const testCaseModel = new AgentEvalTestCaseModel(serverDB, userId);
    const stranger = new AgentEvalTestCaseModel(serverDB, otherUserId);

    expect(await testCaseModel.findByIds(caseIds)).toHaveLength(2);
    expect(await stranger.findByIds(caseIds)).toHaveLength(0);
    expect(await testCaseModel.findByIds([])).toEqual([]);
  });
});
