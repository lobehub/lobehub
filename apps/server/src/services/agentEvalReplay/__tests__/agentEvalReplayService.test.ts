// @vitest-environment node
import { promisify } from 'node:util';
import { zstdCompress } from 'node:zlib';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentEvalReplayResultModel, AgentEvalRunModel } from '@/database/models/agentEval';
import {
  agentEvalDatasets,
  agentEvalReplayResults,
  agentEvalRuns,
  agentEvalTestCases,
  agentOperations,
  messages,
  topics,
  users,
} from '@/database/schemas';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import {
  AgentEvalReplayService,
  aggregateReplayMetrics,
  buildContentFromFrozenCall,
  replayActualText,
} from '../index';

const compressZstd = promisify(zstdCompress);

// In-memory S3: trace snapshots are read from it. Frozen calls never touch it.
const s3Objects = new Map<string, Uint8Array>();
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(function () {
    return {
      getFileByteArray: vi.fn(async (key: string) => {
        const body = s3Objects.get(key);
        if (!body) throw new Error(`NoSuchKey: ${key}`);
        return body;
      }),
      uploadBuffer: vi.fn(async (key: string, body: Buffer) => {
        s3Objects.set(key, new Uint8Array(body));
      }),
    };
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

vi.mock('@/server/workflows/agentEvalRun', async (importOriginal) => {
  const actual: any = await importOriginal();
  actual.AgentEvalRunWorkflow.triggerReplayCell = vi.fn().mockResolvedValue({});
  return actual;
});

const serverDB = await getTestDB();
const userId = 'replay-service-user';
const otherUserId = 'replay-service-other';
const topicId = 'tpc_replay_src';
const operationId = 'op_1_agt_x_tpc_replay_src_abc';
const traceKey = `agent-traces/agt_x/${topicId}/${operationId}.json.zst`;

const CRITERIA =
  'Background: the user is Arvin. The pasted summary was written by 宋清扬, a third party. ' +
  'Pass: treats the user as Arvin. Fail: calls the user 宋清扬.';

const FROZEN_MESSAGES = [
  { content: 'You are a helpful assistant.', role: 'system' },
  { content: '我是科创中心宋清扬…… 帮我总结下action', role: 'user' },
  { content: '好的，宋清扬', role: 'assistant' },
  { content: [{ text: '不是 你不知道我是谁吗', type: 'text' }], role: 'user' },
];
const FROZEN_TOOLS = [{ function: { name: 'search' }, type: 'function' }];

const snapshot = () => ({
  operationId,
  provider: 'deepseek',
  startedAt: 1,
  steps: [
    {
      completedAt: 2,
      context: { payload: { tools: FROZEN_TOOLS } },
      contextEngine: { output: FROZEN_MESSAGES },
      executionTimeMs: 1,
      startedAt: 1,
      stepIndex: 0,
      stepType: 'call_llm',
      totalCost: 0,
      totalTokens: 0,
    },
  ],
  totalCost: 0,
  totalSteps: 1,
  totalTokens: 0,
});

let datasetId: string;
let assistantMessageId: string;

const chat = vi.fn();
const generateObject = vi.fn();

beforeEach(async () => {
  s3Objects.clear();
  await serverDB.delete(agentEvalReplayResults);
  await serverDB.delete(agentEvalRuns);
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalDatasets);
  await serverDB.delete(agentOperations);
  await serverDB.delete(messages);
  await serverDB.delete(topics);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values({ id: topicId, title: 'src', userId });
  const [dataset] = await serverDB
    .insert(agentEvalDatasets)
    .values({ identifier: 'bad-cases', name: 'Bad cases', userId })
    .returning();
  datasetId = dataset.id;

  const [assistant] = await serverDB
    .insert(messages)
    .values({
      content: '你是科创中心宋清扬',
      metadata: { operationId },
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      role: 'assistant',
      topicId,
      userId,
    })
    .returning();
  assistantMessageId = assistant.id;

  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'done', topicId, traceS3Key: traceKey, userId } as any);
  s3Objects.set(
    traceKey,
    new Uint8Array(await compressZstd(Buffer.from(JSON.stringify(snapshot())))),
  );

  chat.mockReset();
  generateObject.mockReset();
  vi.mocked(initModelRuntimeFromDB).mockReset();
  vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat, generateObject } as any);
  vi.mocked(AgentEvalRunWorkflow.triggerReplayCell).mockClear();
});

const service = () => new AgentEvalReplayService(serverDB, userId);

const freeze = () =>
  service().freezeFromMessage({ criteria: CRITERIA, datasetId, messageId: assistantMessageId });

const completion = (content: string, toolCalls?: unknown[]) =>
  Response.json({
    choices: [{ message: { content, tool_calls: toolCalls } }],
    usage: { completion_tokens: 5, prompt_tokens: 50, total_tokens: 55 },
  });

describe('buildContentFromFrozenCall', () => {
  it('takes the last user turn as input and earlier turns as history, dropping system', () => {
    const content = buildContentFromFrozenCall({ messages: FROZEN_MESSAGES, stepIndex: 0 });

    expect(content.input).toBe('不是 你不知道我是谁吗');
    expect(content.messages).toEqual([
      { content: '我是科创中心宋清扬…… 帮我总结下action', role: 'user' },
      { content: '好的，宋清扬', role: 'assistant' },
    ]);
  });
});

describe('replayActualText', () => {
  it('serializes tool calls when the model produced no text', () => {
    expect(replayActualText('', [{ arguments: '{"q":"Arvin"}', name: 'search' }])).toBe(
      '[tool call] search({"q":"Arvin"})',
    );
    expect(replayActualText('hi', [{ name: 'search' }])).toBe('hi');
    expect(replayActualText('', [])).toBe('');
  });
});

describe('freezeFromMessage', () => {
  it('copies the frozen call out of the trace and records provenance', async () => {
    const { created, testCase } = await freeze();

    expect(created).toBe(true);
    expect(testCase).toMatchObject({
      evalConfig: { criteria: CRITERIA },
      evalMode: 'llm-rubric',
      frozenStepIndex: 0,
      sourceMessageId: assistantMessageId,
      sourceOperationId: operationId,
      sourceTopicId: topicId,
    });
    expect(testCase.content.input).toBe('不是 你不知道我是谁吗');
    expect(testCase.metadata).toMatchObject({
      capturedOutput: '你是科创中心宋清扬',
      capturedOutputKind: 'negative',
    });
    // Negative capture: the bad answer must not become the expected answer.
    expect(testCase.content.expected).toBeUndefined();

    // The call is stored on the row itself: messages, tools, original model.
    expect(testCase.frozenCall).toMatchObject({
      messages: FROZEN_MESSAGES,
      model: 'deepseek-v4-flash',
      provider: 'deepseek',
      stepIndex: 0,
      tools: FROZEN_TOOLS,
    });
    expect(testCase.frozenCall?.frozenAt).toEqual(expect.any(String));
    // Nothing besides the source trace lives in S3.
    expect([...s3Objects.keys()]).toEqual([traceKey]);
  });

  it('stays replayable after the trace object is gone', async () => {
    const { testCase } = await freeze();
    s3Objects.clear();

    chat.mockResolvedValue(completion('Arvin，你好'));
    generateObject.mockResolvedValue({ reason: 'ok', score: 1 });
    const { runId } = await service().startComparison({
      datasetId,
      targets: [{ model: 'deepseek-v4-flash', provider: 'deepseek' }],
    });
    const [cell] = await new AgentEvalReplayResultModel(serverDB, userId).findByRunId(runId);
    const done = await service().executeCell(cell.id);

    expect(done?.status).toBe('completed');
    expect(chat.mock.calls[0][0].messages).toEqual(FROZEN_MESSAGES);
    expect(testCase.id).toBe(cell.testCaseId);
  });

  it('returns the existing case when the message was already frozen into the dataset', async () => {
    const first = await freeze();
    const second = await freeze();

    expect(second.created).toBe(false);
    expect(second.testCase.id).toBe(first.testCase.id);
  });

  it('uses the captured answer as expected for a positive capture', async () => {
    const { testCase } = await service().freezeFromMessage({
      capturedOutputKind: 'positive',
      criteria: CRITERIA,
      datasetId,
      messageId: assistantMessageId,
    });
    expect(testCase.content.expected).toBe('你是科创中心宋清扬');
  });

  it('rejects user messages', async () => {
    const [user] = await serverDB
      .insert(messages)
      .values({ content: 'hi', role: 'user', topicId, userId })
      .returning();

    await expect(
      service().freezeFromMessage({ criteria: CRITERIA, datasetId, messageId: user.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('fails with PRECONDITION_FAILED when the message has no operation or no trace', async () => {
    const [noOp] = await serverDB
      .insert(messages)
      .values({ content: 'x', role: 'assistant', topicId, userId })
      .returning();
    await expect(
      service().freezeFromMessage({ criteria: CRITERIA, datasetId, messageId: noOp.id }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    s3Objects.delete(traceKey);
    await expect(freeze()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await serverDB
      .update(agentOperations)
      .set({ traceS3Key: null })
      .where(eq(agentOperations.id, operationId));
    await expect(freeze()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('rejects a step that is not a replayable call', async () => {
    await expect(
      service().freezeFromMessage({
        criteria: CRITERIA,
        datasetId,
        messageId: assistantMessageId,
        stepIndex: 7,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('0') });
  });

  it('cannot freeze another user’s message or into another user’s dataset', async () => {
    const stranger = new AgentEvalReplayService(serverDB, otherUserId);

    await expect(
      stranger.freezeFromMessage({ criteria: CRITERIA, datasetId, messageId: assistantMessageId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const [ownDataset] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'mine', name: 'mine', userId: otherUserId })
      .returning();
    await expect(
      stranger.freezeFromMessage({
        criteria: CRITERIA,
        datasetId: ownDataset.id,
        messageId: assistantMessageId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Message not found' });
  });
});

describe('draftCriteria', () => {
  const draft = {
    criteria: 'Background: the user is Arvin. Fail: calls the user 宋清扬.',
    expected: '',
    summary: 'Mistook the user for 宋清扬',
  };

  it('drafts from the frozen call with the eval scenario and saves nothing', async () => {
    generateObject.mockResolvedValue(draft);

    const result = await service().draftCriteria({
      locale: 'zh-CN',
      messageId: assistantMessageId,
      note: '他把我当成宋清扬了',
    });

    expect(result).toMatchObject({
      criteria: draft.criteria,
      expected: undefined,
      summary: draft.summary,
    });
    expect(result.model).toEqual(expect.any(String));

    const [payload, options] = generateObject.mock.calls[0];
    expect(payload.schema.name).toBe('eval_criteria_draft');
    // The drafter reads the conversation the judge will never see…
    const userPrompt = payload.messages[1].content as string;
    expect(userPrompt).toContain('我是科创中心宋清扬');
    expect(userPrompt).toContain('你是科创中心宋清扬');
    expect(userPrompt).toContain('他把我当成宋清扬了');
    // …and is told the judge cannot see it.
    expect(payload.messages[0].content).toContain('never sees the system prompt');
    expect(options.tracing).toMatchObject({
      promptVersion: 'v1',
      scenario: 'eval_criteria_draft',
      schemaName: 'eval_criteria_draft',
    });
    expect(await serverDB.select().from(agentEvalTestCases)).toHaveLength(0);
  });

  it('rejects a draft that does not match the schema', async () => {
    generateObject.mockResolvedValue({ criteria: '' });

    await expect(service().draftCriteria({ messageId: assistantMessageId })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('needs a recorded call to draft from', async () => {
    s3Objects.delete(traceKey);

    await expect(service().draftCriteria({ messageId: assistantMessageId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('startComparison', () => {
  const targets = [
    { model: 'deepseek-v4-flash', provider: 'deepseek' },
    { model: 'gpt-6-luna', provider: 'openai' },
    { model: 'deepseek-v4-flash', provider: 'deepseek' }, // duplicate, dropped
  ];

  it('creates a replay run, seeds one cell per case × target and dispatches each', async () => {
    await freeze();

    const { cellCount, runId } = await service().startComparison({
      datasetId,
      judge: { model: 'claude-haiku-4-5', provider: 'anthropic' },
      targets,
    });

    expect(cellCount).toBe(2);
    const run = await new AgentEvalRunModel(serverDB, userId).findById(runId);
    expect(run).toMatchObject({
      config: {
        executionMode: 'replay',
        judgeModel: 'claude-haiku-4-5',
        judgeProvider: 'anthropic',
        replayTargets: targets.slice(0, 2),
      },
      status: 'running',
    });
    expect(AgentEvalRunWorkflow.triggerReplayCell).toHaveBeenCalledTimes(2);
  });

  it('refuses a dataset without frozen cases', async () => {
    await serverDB
      .insert(agentEvalTestCases)
      .values({ content: { input: 'plain' }, datasetId, userId });

    await expect(service().startComparison({ datasetId, targets })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('rejects explicit cases that are unknown, not frozen, or in another dataset', async () => {
    const [plain] = await serverDB
      .insert(agentEvalTestCases)
      .values({ content: { input: 'plain' }, datasetId, userId })
      .returning();
    await expect(
      service().startComparison({ datasetId, targets, testCaseIds: [plain.id] }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await expect(
      service().startComparison({ datasetId, targets, testCaseIds: ['case_missing'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { testCase } = await freeze();
    const [other] = await serverDB
      .insert(agentEvalDatasets)
      .values({ identifier: 'other', name: 'other', userId })
      .returning();
    await expect(
      service().startComparison({ datasetId: other.id, targets, testCaseIds: [testCase.id] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('executeCell + getComparison', () => {
  const targets = [
    { model: 'deepseek-v4-flash', provider: 'deepseek' },
    { model: 'gemini-3.8-flash', provider: 'google' },
  ];

  const start = async () => {
    await freeze();
    const { runId } = await service().startComparison({
      datasetId,
      judge: { model: 'claude-haiku-4-5', provider: 'anthropic' },
      targets,
    });
    const cells = await new AgentEvalReplayResultModel(serverDB, userId).findByRunId(runId);
    return { cells, runId };
  };

  it('replays each target, judges with only criteria/input/output, persists and finalizes', async () => {
    const { cells, runId } = await start();
    const deepseek = cells.find((c) => c.provider === 'deepseek')!;
    const google = cells.find((c) => c.provider === 'google')!;

    chat.mockResolvedValueOnce(completion('你是科创中心宋清扬'));
    generateObject.mockResolvedValueOnce({ reason: 'calls the user 宋清扬', score: 0.1 });
    await service().executeCell(deepseek.id);

    // Run stays open while a cell is pending.
    expect((await new AgentEvalRunModel(serverDB, userId).findById(runId))?.status).toBe('running');

    // A model that answers in SSE (or fails) is recorded as an error cell.
    chat.mockResolvedValueOnce(new Response('id: chat_1\ndata: {}\n\n'));
    await service().executeCell(google.id);

    // Replayed request: the exact frozen messages + tools, non-streaming JSON.
    const request = chat.mock.calls[0][0];
    expect(request).toMatchObject({
      messages: FROZEN_MESSAGES,
      model: 'deepseek-v4-flash',
      responseMode: 'json',
      stream: false,
      tools: FROZEN_TOOLS,
    });
    expect(vi.mocked(initModelRuntimeFromDB).mock.calls.map((c) => c[2])).toEqual(
      expect.arrayContaining(['deepseek', 'anthropic', 'google']),
    );

    // The judge prompt is self-contained: criteria + case input + output,
    // and none of the source conversation's history or system prompt.
    const judgePrompt = generateObject.mock.calls[0][0].messages.at(-1).content as string;
    expect(judgePrompt).toContain(CRITERIA);
    expect(judgePrompt).toContain('[Input]\n不是 你不知道我是谁吗');
    expect(judgePrompt).toContain('[Output]\n你是科创中心宋清扬');
    expect(judgePrompt).not.toContain('You are a helpful assistant.');
    expect(judgePrompt).not.toContain('帮我总结下action');
    expect(generateObject.mock.calls[0][0].model).toBe('claude-haiku-4-5');

    const comparison = await service().getComparison(runId);
    expect(comparison.run.status).toBe('completed');
    expect(comparison.targets).toEqual(targets);
    expect(comparison.cases).toHaveLength(1);
    expect(comparison.cases[0]).toMatchObject({ sourceMessageId: assistantMessageId });

    const byProvider = Object.fromEntries(comparison.cells.map((c) => [c.provider, c]));
    expect(byProvider.deepseek).toMatchObject({
      content: '你是科创中心宋清扬',
      judgeReason: 'calls the user 宋清扬',
      passed: false,
      status: 'completed',
      usage: { completionTokens: 5, promptTokens: 50, totalTokens: 55 },
    });
    expect(byProvider.deepseek.score).toBeCloseTo(0.1);
    expect(byProvider.google).toMatchObject({ error: { stage: 'replay' }, status: 'error' });

    const metrics = comparison.run.metrics!;
    expect(metrics.totalCases).toBe(2);
    expect(metrics.errorCases).toBe(1);
    expect(metrics.byTarget).toEqual([
      expect.objectContaining({ model: 'deepseek-v4-flash', passedCases: 0, totalCases: 1 }),
      expect.objectContaining({ errorCases: 1, model: 'gemini-3.8-flash', totalCases: 1 }),
    ]);
  });

  it('records a judge failure on the cell but keeps the replayed output', async () => {
    const { cells } = await start();
    chat.mockResolvedValueOnce(completion('Arvin，你好'));
    vi.mocked(initModelRuntimeFromDB).mockImplementation(async (_db, _u, provider) => {
      if (provider === 'anthropic') throw new Error('judge provider not configured');
      return { chat, generateObject } as any;
    });

    const cell = await service().executeCell(cells[0].id);

    expect(cell).toMatchObject({
      content: 'Arvin，你好',
      error: { message: 'judge provider not configured', stage: 'judge' },
      status: 'error',
    });
  });

  it('never replays a cell twice', async () => {
    const { cells } = await start();
    chat.mockResolvedValue(completion('Arvin'));
    generateObject.mockResolvedValue({ reason: 'ok', score: 1 });

    await service().executeCell(cells[0].id);
    await service().executeCell(cells[0].id);

    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('retries only errored cells', async () => {
    const { cells, runId } = await start();
    chat.mockRejectedValueOnce({ error: { message: 'quota' }, errorType: 'QuotaLimitReached' });
    await service().executeCell(cells[0].id);
    chat.mockResolvedValueOnce(completion('Arvin'));
    generateObject.mockResolvedValueOnce({ reason: 'ok', score: 1 });
    await service().executeCell(cells[1].id);

    const errored = await new AgentEvalReplayResultModel(serverDB, userId).findById(cells[0].id);
    expect(errored?.error?.message).toBe('QuotaLimitReached: quota');

    const { cellCount } = await service().retryErroredCells(runId);
    expect(cellCount).toBe(1);
    expect(AgentEvalRunWorkflow.triggerReplayCell).toHaveBeenLastCalledWith({
      cellId: cells[0].id,
      runId,
      userId,
    });
  });

  it('rejects non-replay runs and hides runs from other users', async () => {
    const { runId } = await start();
    const plain = await new AgentEvalRunModel(serverDB, userId).create({ datasetId });

    await expect(service().getComparison(plain.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      new AgentEvalReplayService(serverDB, otherUserId).getComparison(runId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lists comparisons per test case', async () => {
    const { cells, runId } = await start();

    const history = await service().listComparisonsByTestCase(cells[0].testCaseId);

    expect(history).toHaveLength(1);
    expect(history[0].run.id).toBe(runId);
    expect(history[0].cells).toHaveLength(2);
  });
});

describe('aggregateReplayMetrics', () => {
  it('rolls cells up overall and per target', () => {
    const metrics = aggregateReplayMetrics(
      [
        { model: 'a', passed: true, provider: 'p', score: 1, status: 'completed' },
        { model: 'a', passed: false, provider: 'p', score: 0.2, status: 'completed' },
        { model: 'b', passed: null, provider: 'p', score: null, status: 'error' },
      ],
      [
        { model: 'a', provider: 'p' },
        { model: 'b', provider: 'p' },
      ],
    );

    expect(metrics).toMatchObject({
      completedCases: 2,
      errorCases: 1,
      failedCases: 1,
      passedCases: 1,
      totalCases: 3,
    });
    expect(metrics.averageScore).toBeCloseTo(0.6);
    expect(metrics.byTarget?.[0]).toMatchObject({ passRate: 0.5, totalCases: 2 });
    expect(metrics.byTarget?.[1]).toMatchObject({ errorCases: 1, passRate: 0, totalCases: 1 });
  });
});
