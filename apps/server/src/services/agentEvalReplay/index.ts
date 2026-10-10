import {
  buildReplayRequest,
  extractCompletionText,
  extractToolCalls,
  type FrozenCall,
  listReplayableSteps,
  selectFrozenCall,
} from '@lobechat/agent-tracing/replay';
import { TRACING_SCENARIOS } from '@lobechat/const';
import { evaluate } from '@lobechat/eval-rubric';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainEvalCriteriaDraft,
  EVAL_CRITERIA_DRAFT_JSON_SCHEMA,
  EVAL_CRITERIA_DRAFT_PROMPT_VERSION,
  type EvalCriteriaDraftTurn,
} from '@lobechat/prompts';
import type {
  EvalBenchmarkRubric,
  EvalCriteriaDraft,
  EvalFrozenCall,
  EvalReplayOptions,
  EvalReplayTarget,
  EvalReplayTargetMetrics,
  EvalReplayToolCall,
  EvalRunMetrics,
  EvalTestCaseContent,
  RubricType,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalReplayResultModel,
  AgentEvalRunModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import type { AgentEvalReplayResultItem, AgentEvalTestCaseItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { S3SnapshotStore } from '@/server/modules/AgentTracing';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { createEvalJudgeContext, resolveEvalJudgeModel } from '../agentEvalRun/judgeContext';

const log = debug('lobe-server:agent-eval-replay');

const DEFAULT_PASS_THRESHOLD = 0.6;
const DISPATCH_CONCURRENCY = 8;
const REPLAY_TRIGGER = 'eval-replay';

export interface FreezeFromMessageParams {
  /** Whether the frozen answer is the bad case (negative) or a reference answer (positive). */
  capturedOutputKind?: 'negative' | 'positive';
  /**
   * Self-contained pass/fail standard. The judge never sees the source
   * conversation — only this text, the case input, the replayed output and
   * `expected` — so every background fact a verdict depends on goes here.
   */
  criteria: string;
  datasetId: string;
  expected?: string;
  messageId: string;
  /** Snapshot step to freeze; defaults to the operation's last `call_llm`. */
  stepIndex?: number;
}

export interface DraftCriteriaParams {
  capturedOutputKind?: 'negative' | 'positive';
  /** Locale to write the draft in, e.g. `zh-CN`. */
  locale?: string;
  messageId: string;
  /** What the user says is wrong (or right) about the answer. */
  note?: string;
  stepIndex?: number;
}

export interface StartComparisonParams {
  datasetId: string;
  judge?: { model: string; provider: string };
  name?: string;
  passThreshold?: number;
  replayOptions?: EvalReplayOptions;
  targets: EvalReplayTarget[];
  /** Restrict to these cases; defaults to every frozen case in the dataset. */
  testCaseIds?: string[];
}

/** Text of a chat message whose content may be a string or an array of parts. */
const messageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      typeof part === 'string'
        ? part
        : typeof (part as { text?: unknown })?.text === 'string'
          ? (part as { text: string }).text
          : '',
    )
    .join('');
};

/**
 * The case's input is the last user turn the frozen call answered; the turns
 * before it become `content.messages` for the detail page. System prompts and
 * tool traffic stay only in the frozen payload, which is what replay sends.
 */
export const buildContentFromFrozenCall = (
  call: FrozenCall,
): Pick<EvalTestCaseContent, 'input' | 'messages'> => {
  const turns = (call.messages as Array<{ content?: unknown; role?: string }>)
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ content: messageText(m.content), role: m.role as 'assistant' | 'user' }))
    .filter((m) => m.content.length > 0);

  const lastUserIndex = turns.findLastIndex((m) => m.role === 'user');
  if (lastUserIndex < 0) return { input: '' };

  const history = turns.slice(0, lastUserIndex);
  return {
    input: turns[lastUserIndex].content,
    ...(history.length > 0 && { messages: history }),
  };
};

const criteriaDraftSchema = z.object({
  criteria: z.string().trim().min(1),
  expected: z.string(),
  summary: z.string().trim().min(1),
});

/** Per-turn and total caps on what the drafting model reads, newest turns kept. */
const DRAFT_TURN_CHARS = 4000;
const DRAFT_TOTAL_CHARS = 40_000;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n…[${text.length - max} more characters]` : text;

/**
 * The frozen call as a transcript for the criteria drafter: system prompt,
 * turns and tool results — the facts a verdict may hinge on — clipped so a
 * long agent run still fits, keeping the system prompt and the latest turns.
 */
export const buildDraftConversation = (call: FrozenCall): EvalCriteriaDraftTurn[] => {
  const turns = (call.messages as Array<{ content?: unknown; role?: string }>)
    .map((m) => ({ content: clip(messageText(m.content), DRAFT_TURN_CHARS), role: m.role ?? '' }))
    .filter((m) => m.role && m.content.length > 0);

  const [first, ...rest] = turns;
  const head = first?.role === 'system' ? [first] : [];
  const body = first?.role === 'system' ? rest : turns;

  let budget = DRAFT_TOTAL_CHARS - (head[0]?.content.length ?? 0);
  const kept: EvalCriteriaDraftTurn[] = [];
  for (let i = body.length - 1; i >= 0 && budget > 0; i--) {
    kept.unshift(body[i]);
    budget -= body[i].content.length;
  }
  return [...head, ...kept];
};

/**
 * What the judge scores when the model answered with tool calls only: an empty
 * string would read as "no output" and fail every tool-calling model.
 */
export const replayActualText = (content: string, toolCalls: EvalReplayToolCall[]): string => {
  if (content) return content;
  if (toolCalls.length === 0) return '';
  return toolCalls.map((call) => `[tool call] ${call.name}(${call.arguments ?? ''})`).join('\n');
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  // Model runtime rejects with a ChatCompletionErrorPayload, not an Error.
  const payload = error as { error?: { message?: string } | string; errorType?: string };
  const inner = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
  return [payload?.errorType, inner].filter(Boolean).join(': ') || JSON.stringify(error);
};

export const aggregateReplayMetrics = (
  cells: Pick<AgentEvalReplayResultItem, 'model' | 'passed' | 'provider' | 'score' | 'status'>[],
  targets: EvalReplayTarget[],
): EvalRunMetrics => {
  const summarize = (subset: typeof cells) => {
    const scored = subset.filter((c) => c.status === 'completed' && typeof c.score === 'number');
    const passed = subset.filter((c) => c.passed === true).length;
    const errors = subset.filter((c) => c.status === 'error').length;
    return {
      averageScore: scored.length
        ? scored.reduce((sum, c) => sum + (c.score ?? 0), 0) / scored.length
        : 0,
      errorCases: errors,
      passedCases: passed,
      passRate: subset.length ? passed / subset.length : 0,
      totalCases: subset.length,
    };
  };

  const byTarget: EvalReplayTargetMetrics[] = targets.map((target) => ({
    ...summarize(cells.filter((c) => c.provider === target.provider && c.model === target.model)),
    model: target.model,
    provider: target.provider,
  }));

  const overall = summarize(cells);
  return {
    ...overall,
    byTarget,
    completedCases: cells.filter((c) => c.status === 'completed').length,
    failedCases: cells.filter((c) => c.status === 'completed' && c.passed === false).length,
  };
};

/**
 * Cross-model comparison over frozen LLM calls.
 *
 * A bad answer from a real conversation is frozen into a test case (the exact
 * request the model saw, copied out of the operation trace), then re-issued
 * against N models in a `replay` run. Each (case × model) cell is replayed and
 * judged independently and persisted in `agent_eval_replay_results`.
 */
export class AgentEvalReplayService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  private readonly benchmarkModel: AgentEvalBenchmarkModel;
  private readonly datasetModel: AgentEvalDatasetModel;
  private readonly replayResultModel: AgentEvalReplayResultModel;
  private readonly runModel: AgentEvalRunModel;
  private readonly testCaseModel: AgentEvalTestCaseModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;

    this.benchmarkModel = new AgentEvalBenchmarkModel(db, userId, workspaceId);
    this.datasetModel = new AgentEvalDatasetModel(db, userId, workspaceId);
    this.replayResultModel = new AgentEvalReplayResultModel(db, userId, workspaceId);
    this.runModel = new AgentEvalRunModel(db, userId, workspaceId);
    this.testCaseModel = new AgentEvalTestCaseModel(db, userId, workspaceId);
  }

  // ============================================
  // Freeze
  // ============================================

  /**
   * Freeze the LLM call that produced an assistant message into a test case.
   * Freezing a message already frozen into the same dataset returns that case.
   */
  async freezeFromMessage(
    params: FreezeFromMessageParams,
  ): Promise<{ created: boolean; testCase: AgentEvalTestCaseItem }> {
    const { capturedOutputKind = 'negative', criteria, datasetId, messageId, stepIndex } = params;

    const dataset = await this.datasetModel.findById(datasetId);
    if (!dataset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset not found' });

    const message = await this.findAssistantMessage(messageId);

    const existing = await this.testCaseModel.findByDatasetIdAndSourceMessageId(
      datasetId,
      messageId,
    );
    if (existing) return { created: false, testCase: existing };

    const { call, operationId } = await this.loadFrozenCall(message, stepIndex);

    const frozenCall: EvalFrozenCall = {
      frozenAt: new Date().toISOString(),
      messages: call.messages,
      model: message.model ?? undefined,
      params: call.params,
      provider: message.provider ?? undefined,
      stepIndex: call.stepIndex,
      tools: call.tools,
    };

    const capturedOutput = message.content ?? '';
    const expected =
      params.expected ?? (capturedOutputKind === 'positive' ? capturedOutput : undefined);

    const testCase = await this.testCaseModel.create({
      content: { ...buildContentFromFrozenCall(call), ...(expected && { expected }) },
      datasetId,
      evalConfig: { criteria },
      evalMode: 'llm-rubric',
      frozenCall,
      frozenStepIndex: call.stepIndex,
      metadata: { capturedOutput, capturedOutputKind, source: 'conversation-freeze' },
      sourceMessageId: messageId,
      sourceOperationId: operationId,
      sourceTopicId: message.topicId,
    });

    log(
      'Froze message %s (op %s, step %d) into case %s',
      messageId,
      operationId,
      call.stepIndex,
      testCase.id,
    );
    return { created: true, testCase };
  }

  /**
   * Draft the self-contained criteria (and expected answer) for freezing a
   * message. Nothing is saved: the user reviews and edits the draft, and only
   * `freezeFromMessage` writes the case.
   *
   * The model reads the frozen call — the exact context the answer was given
   * in — because the judge later will not: whatever the verdict depends on has
   * to be written into the criteria now.
   */
  async draftCriteria(params: DraftCriteriaParams): Promise<EvalCriteriaDraft> {
    const { capturedOutputKind = 'negative', locale, messageId, note, stepIndex } = params;

    const message = await this.findAssistantMessage(messageId);
    const { call } = await this.loadFrozenCall(message, stepIndex);

    const { model, provider } = await resolveEvalJudgeModel(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);

    const raw = await ai.generateObject(
      {
        ...chainEvalCriteriaDraft({
          capturedOutput: message.content ?? '',
          capturedOutputKind,
          conversation: buildDraftConversation(call),
          locale,
          note,
        }),
        model,
        provider,
        schema: EVAL_CRITERIA_DRAFT_JSON_SCHEMA,
      },
      {
        metadata: { trigger: RequestTrigger.Eval },
        tracing: {
          promptVersion: EVAL_CRITERIA_DRAFT_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.EvalCriteriaDraft,
          schemaName: EVAL_CRITERIA_DRAFT_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = criteriaDraftSchema.safeParse(raw);
    if (!parsed.success) {
      log('criteria draft did not match schema: %O', parsed.error.flatten());
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The drafted criteria did not match the expected shape',
      });
    }

    return {
      criteria: parsed.data.criteria.trim(),
      expected: parsed.data.expected.trim() || undefined,
      model,
      provider,
      summary: parsed.data.summary.trim(),
    };
  }

  private async findAssistantMessage(messageId: string) {
    const message = await new MessageModel(this.db, this.userId, this.workspaceId).findById(
      messageId,
    );
    if (!message) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
    if (message.role !== 'assistant') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Only assistant messages can be frozen (got "${message.role}")`,
      });
    }
    return message;
  }

  /** The recorded `call_llm` behind an assistant message, read from its operation trace. */
  private async loadFrozenCall(
    message: { metadata?: unknown },
    stepIndex?: number,
  ): Promise<{ call: FrozenCall; operationId: string }> {
    const operationId = (message.metadata as { operationId?: string } | null)?.operationId;
    if (!operationId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This message has no recorded operation, so there is no LLM call to freeze',
      });
    }

    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findOwnOperationById(operationId);
    if (!operation?.traceS3Key) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `No trace was recorded for operation ${operationId}`,
      });
    }

    const snapshot = await new S3SnapshotStore().loadByKey(operation.traceS3Key);
    if (!snapshot) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `The trace of operation ${operationId} is no longer available`,
      });
    }

    const call = selectFrozenCall(snapshot, stepIndex);
    if (!call) {
      const steps = listReplayableSteps(snapshot);
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          stepIndex === undefined
            ? 'The trace has no call_llm step with a recorded payload'
            : `Step ${stepIndex} is not a replayable call_llm step. Available: ${steps.join(', ') || '(none)'}`,
      });
    }

    return { call, operationId };
  }

  // ============================================
  // Compare
  // ============================================

  /**
   * Create a `replay` run over the dataset's frozen cases, seed one pending
   * cell per (case × target) and dispatch every cell to the workflow.
   */
  async startComparison(params: StartComparisonParams) {
    const { datasetId, name, passThreshold, replayOptions, targets, testCaseIds } = params;

    const dataset = await this.datasetModel.findById(datasetId);
    if (!dataset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dataset not found' });

    const uniqueTargets = [
      ...new Map(targets.map((t) => [`${t.provider}/${t.model}`, t])).values(),
    ];

    const candidates = testCaseIds
      ? await this.testCaseModel.findByIds(testCaseIds)
      : await this.testCaseModel.findByDatasetId(datasetId);

    if (testCaseIds) {
      const found = new Set(candidates.map((c) => c.id));
      const missing = testCaseIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Test case(s) not found: ${missing.join(', ')}`,
        });
      }
      const foreign = candidates.filter((c) => c.datasetId !== datasetId);
      if (foreign.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Test case(s) not in dataset ${datasetId}: ${foreign.map((c) => c.id).join(', ')}`,
        });
      }
    }

    const notFrozen = candidates.filter((c) => !c.frozenCall);
    if (testCaseIds && notFrozen.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Test case(s) have no frozen call to replay: ${notFrozen.map((c) => c.id).join(', ')}`,
      });
    }

    const cases = candidates.filter((c) => c.frozenCall);
    if (cases.length === 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The dataset has no frozen test cases to compare',
      });
    }

    const judge = await resolveEvalJudgeModel(this.db, this.userId, params.judge);

    const run = await this.runModel.create({
      config: {
        executionMode: 'replay',
        judgeModel: judge.model,
        judgeProvider: judge.provider,
        passThreshold: passThreshold ?? DEFAULT_PASS_THRESHOLD,
        replayOptions,
        replayTargets: uniqueTargets,
      },
      datasetId,
      name: name ?? `Compare ${uniqueTargets.map((t) => t.model).join(' vs ')}`,
      status: 'running',
      startedAt: new Date(),
    });

    const cells = await this.replayResultModel.seedPending(
      run.id,
      cases.map((c) => c.id),
      uniqueTargets,
    );

    await this.dispatchCells(run.id, cells);

    return { cellCount: cells.length, runId: run.id };
  }

  /** Re-dispatch the errored cells of a finished comparison. */
  async retryErroredCells(runId: string) {
    const run = await this.getReplayRun(runId);
    const cells = await this.replayResultModel.resetErrored(runId);
    if (cells.length === 0) return { cellCount: 0, runId };

    await this.runModel.update(run.id, { status: 'running' });
    await this.dispatchCells(run.id, cells);
    return { cellCount: cells.length, runId };
  }

  private async dispatchCells(runId: string, cells: Pick<AgentEvalReplayResultItem, 'id'>[]) {
    await pMap(
      cells,
      (cell) =>
        AgentEvalRunWorkflow.triggerReplayCell({ cellId: cell.id, runId, userId: this.userId }),
      { concurrency: DISPATCH_CONCURRENCY },
    );
  }

  /**
   * Replay one cell and judge it. Errors are recorded on the cell rather than
   * thrown, so one failing model never blocks the rest of the grid.
   */
  async executeCell(cellId: string) {
    const claimed = await this.replayResultModel.claim(cellId);
    if (!claimed) {
      log('Cell %s is not pending, skipping', cellId);
      return this.replayResultModel.findById(cellId);
    }

    const run = await this.runModel.findById(claimed.runId);
    if (!run || run.status === 'aborted') {
      return this.replayResultModel.update(cellId, {
        error: { message: 'Run was aborted', stage: 'replay' },
        status: 'error',
      });
    }

    const testCase = await this.testCaseModel.findById(claimed.testCaseId);
    if (!testCase?.frozenCall) {
      const cell = await this.replayResultModel.update(cellId, {
        error: { message: 'Test case has no frozen call', stage: 'replay' },
        status: 'error',
      });
      await this.finalizeIfDone(run.id);
      return cell;
    }

    const target = { model: claimed.model, provider: claimed.provider };
    const options = run.config?.replayOptions;
    const startedAt = Date.now();

    let content: string;
    let toolCalls: EvalReplayToolCall[];
    let usage: AgentEvalReplayResultItem['usage'];

    try {
      const call: FrozenCall = testCase.frozenCall;
      const request = buildReplayRequest({
        call,
        maxTokens: options?.maxTokens,
        target: { ...target, label: `${target.provider}/${target.model}` },
        temperature: options?.temperature,
        withTools: options?.withTools,
      });

      const runtime = await initModelRuntimeFromDB(
        this.db,
        this.userId,
        target.provider,
        this.workspaceId,
      );
      const response = await runtime.chat(request as any, {
        metadata: { trigger: REPLAY_TRIGGER },
        user: this.userId,
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

      const body = (await response.json()) as {
        usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
      };
      content = extractCompletionText(body);
      toolCalls = extractToolCalls(body);
      usage = {
        completionTokens: body?.usage?.completion_tokens,
        promptTokens: body?.usage?.prompt_tokens,
        totalTokens: body?.usage?.total_tokens,
      };
    } catch (error) {
      log('Replay failed for cell %s: %O', cellId, error);
      const cell = await this.replayResultModel.update(cellId, {
        durationMs: Date.now() - startedAt,
        error: { message: errorMessage(error), stage: 'replay' },
        status: 'error',
      });
      await this.finalizeIfDone(run.id);
      return cell;
    }

    const durationMs = Date.now() - startedAt;
    const rubrics = await this.resolveRubrics(testCase);

    let verdict: { judgeReason?: string; passed?: boolean; score?: number } = {};
    let judgeError: string | undefined;

    if (rubrics.length > 0) {
      try {
        const matchContext = await createEvalJudgeContext({
          db: this.db,
          judge: { model: run.config!.judgeModel!, provider: run.config!.judgeProvider! },
          trigger: REPLAY_TRIGGER,
          userId: this.userId,
          workspaceId: this.workspaceId,
        });
        const result = await evaluate(
          { actual: replayActualText(content, toolCalls), rubrics, testCase: testCase.content },
          {
            matchContext,
            passThreshold: run.config?.passThreshold ?? DEFAULT_PASS_THRESHOLD,
          },
        );
        verdict = {
          judgeReason: result.rubricResults
            .map((r) => r.reason)
            .filter(Boolean)
            .join('\n'),
          passed: result.passed,
          score: result.score,
        };
      } catch (error) {
        judgeError = errorMessage(error);
      }
    }

    const cell = await this.replayResultModel.update(cellId, {
      content,
      durationMs,
      error: judgeError ? { message: judgeError, stage: 'judge' } : null,
      judgeReason: verdict.judgeReason ?? null,
      passed: verdict.passed ?? null,
      score: verdict.score ?? null,
      status: judgeError ? 'error' : 'completed',
      toolCalls,
      usage,
    });

    await this.finalizeIfDone(run.id);
    return cell;
  }

  /** Case evalMode > dataset evalMode > benchmark rubrics — same order as agent runs. */
  private async resolveRubrics(testCase: AgentEvalTestCaseItem): Promise<EvalBenchmarkRubric[]> {
    const dataset = await this.datasetModel.findById(testCase.datasetId);
    const evalMode = (testCase.evalMode ?? dataset?.evalMode) as RubricType | null | undefined;
    const evalConfig = testCase.evalConfig ?? dataset?.evalConfig;

    if (evalMode && evalMode !== 'external') {
      return [
        {
          config: (evalConfig ?? {}) as unknown as EvalBenchmarkRubric['config'],
          id: `eval-mode-${evalMode}`,
          name: evalMode,
          type: evalMode,
          weight: 1,
        },
      ];
    }

    if (!dataset?.benchmarkId) return [];
    const benchmark = await this.benchmarkModel.findById(dataset.benchmarkId);
    return benchmark?.rubrics ?? [];
  }

  /** Close the run once no cell is pending or running. Safe to call repeatedly. */
  async finalizeIfDone(runId: string) {
    if ((await this.replayResultModel.countUnfinished(runId)) > 0) return;

    const run = await this.runModel.findById(runId);
    if (!run || run.status === 'aborted') return;

    const cells = await this.replayResultModel.findByRunId(runId);
    const metrics = aggregateReplayMetrics(cells, run.config?.replayTargets ?? []);
    const allErrored = cells.length > 0 && cells.every((c) => c.status === 'error');

    await this.runModel.update(runId, {
      metrics: {
        ...metrics,
        duration: run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : undefined,
      },
      status: allErrored ? 'failed' : 'completed',
    });
  }

  // ============================================
  // Query
  // ============================================

  private async getReplayRun(runId: string) {
    const run = await this.runModel.findById(runId);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });
    if (run.config?.executionMode !== 'replay') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Run is not a replay comparison' });
    }
    return run;
  }

  /** Model × case grid of one comparison run. */
  async getComparison(runId: string) {
    const run = await this.getReplayRun(runId);
    const cells = await this.replayResultModel.findByRunId(runId);
    const cases = await this.testCaseModel.findByIds([...new Set(cells.map((c) => c.testCaseId))]);

    return {
      cases: cases.map((c) => ({
        content: c.content,
        evalConfig: c.evalConfig,
        evalMode: c.evalMode,
        frozenStepIndex: c.frozenStepIndex,
        id: c.id,
        metadata: c.metadata,
        sourceMessageId: c.sourceMessageId,
        sourceOperationId: c.sourceOperationId,
        sourceTopicId: c.sourceTopicId,
      })),
      cells,
      judge: { model: run.config?.judgeModel, provider: run.config?.judgeProvider },
      run,
      targets: run.config?.replayTargets ?? [],
    };
  }

  /** Every comparison a test case took part in, newest first, with its cells. */
  async listComparisonsByTestCase(testCaseId: string) {
    const rows = await this.replayResultModel.findByTestCaseId(testCaseId);

    const byRun = new Map<
      string,
      { cells: AgentEvalReplayResultItem[]; run: (typeof rows)[number]['run'] }
    >();
    for (const { cell, run } of rows) {
      const entry = byRun.get(run.id) ?? { cells: [], run };
      entry.cells.push(cell);
      byRun.set(run.id, entry);
    }
    return [...byRun.values()];
  }
}
