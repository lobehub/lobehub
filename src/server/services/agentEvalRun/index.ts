import { type LobeChatDatabase } from '@lobechat/database';
import { evaluate } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalRunAgentSnapshot,
  EvalRunConfig,
  EvalRunInputConfig,
  EvalRunMetrics,
  EvalRunTopicResult,
  RubricType,
} from '@lobechat/types';

import {
  AgentEvalBenchmarkModel,
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { appEnv } from '@/envs/app';
import { AgentService } from '@/server/services/agent';
import { AgentRuntimeService } from '@/server/services/agentRuntime/AgentRuntimeService';
import { AiAgentService } from '@/server/services/aiAgent';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

/** Round cost to at most 6 decimal places to avoid floating-point noise */
const roundCost = (v: number): number => Math.round(v * 1e6) / 1e6;

export class AgentEvalRunService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly runModel: AgentEvalRunModel;
  private readonly benchmarkModel: AgentEvalBenchmarkModel;
  private readonly datasetModel: AgentEvalDatasetModel;
  private readonly runTopicModel: AgentEvalRunTopicModel;
  private readonly testCaseModel: AgentEvalTestCaseModel;
  private readonly messageModel: MessageModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentService: AgentService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.runModel = new AgentEvalRunModel(db, userId);
    this.benchmarkModel = new AgentEvalBenchmarkModel(db, userId);
    this.datasetModel = new AgentEvalDatasetModel(db, userId);
    this.runTopicModel = new AgentEvalRunTopicModel(db, userId);
    this.testCaseModel = new AgentEvalTestCaseModel(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.threadModel = new ThreadModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.agentService = new AgentService(db, userId);
  }

  async createRun(params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    name?: string;
    targetAgentId?: string;
  }) {
    const agentSnapshot = params.targetAgentId
      ? await this.snapshotAgentConfig(params.targetAgentId)
      : undefined;

    const config = { ...params.config, agentSnapshot };

    const run = await this.runModel.create({ ...params, config });

    // Pre-create Topics and RunTopics for all test cases (status='pending')
    const testCases = await this.testCaseModel.findByDatasetId(params.datasetId);

    if (testCases.length > 0) {
      const createdTopics = await this.topicModel.batchCreate(
        testCases.map((tc) => ({
          agentId: params.targetAgentId ?? undefined,
          title: `[Eval Case #${(tc.sortOrder ?? 0) + 1}] ${tc.content?.input?.slice(0, 50) || 'Test Case'}...`,
          trigger: 'eval',
        })),
      );

      await this.runTopicModel.batchCreate(
        createdTopics.map((topic, index) => ({
          runId: run.id,
          status: 'pending' as const,
          testCaseId: testCases[index].id,
          topicId: topic.id,
        })),
      );
    }

    return run;
  }

  async deleteRun(id: string) {
    // 1. Get associated topics before deletion (cascade will remove run_topics rows)
    const runTopics = await this.runTopicModel.findByRunId(id);
    const topicIds = runTopics.map((rt) => rt.topicId).filter(Boolean);

    // 2. Delete the run (cascades to run_topics)
    const result = await this.runModel.delete(id);

    // 3. Delete orphaned topics
    if (topicIds.length > 0) {
      await this.topicModel.batchDelete(topicIds);
    }

    return result;
  }

  async abortRun(runId: string) {
    // 1. Find all running RunTopics and interrupt their agent operations
    const runTopics = await this.runTopicModel.findByRunId(runId);
    const runningTopics = runTopics.filter((t) => t.status === 'running');

    if (runningTopics.length > 0) {
      const agentRuntimeService = new AgentRuntimeService(this.db, this.userId);
      for (const rt of runningTopics) {
        const opId = (rt.evalResult as EvalRunTopicResult)?.operationId;
        if (opId) {
          try {
            await agentRuntimeService.interruptOperation(opId);
          } catch {
            // best effort
          }
        }
      }
    }

    // 2. Mark all pending/running RunTopics as aborted (error + 'Aborted')
    await this.runTopicModel.batchMarkAborted(runId);

    // 3. Update run status to aborted
    await this.runModel.update(runId, { status: 'aborted' });
  }

  async retryErrorCases(runId: string): Promise<{ retryCount: number }> {
    const run = await this.runModel.findById(runId);
    if (!run) throw new Error('Run not found');

    const allTopics = await this.runTopicModel.findByRunId(runId);
    const errorTopics = allTopics.filter((t) => t.status === 'error' || t.status === 'timeout');

    if (errorTopics.length === 0) return { retryCount: 0 };

    // Collect test case IDs and info for recreation
    const errorTestCases = errorTopics.map((t) => ({
      id: t.testCaseId,
      input: t.testCase?.content?.input,
      sortOrder: t.testCase?.sortOrder,
    }));

    // 1. Delete error/timeout RunTopics
    await this.runTopicModel.deleteErrorRunTopics(runId);

    // 2. Delete orphan Topics (old conversations)
    const topicIds = errorTopics.map((t) => t.topicId).filter(Boolean);
    if (topicIds.length > 0) await this.topicModel.batchDelete(topicIds);

    // 3. Create new Topics and pending RunTopics for the error test cases
    const createdTopics = await this.topicModel.batchCreate(
      errorTestCases.map((tc) => ({
        agentId: run.targetAgentId ?? undefined,
        title: `[Eval Case #${(tc.sortOrder ?? 0) + 1}] ${tc.input?.slice(0, 50) || 'Test Case'}...`,
        trigger: 'eval',
      })),
    );

    await this.runTopicModel.batchCreate(
      createdTopics.map((topic, index) => ({
        runId,
        status: 'pending' as const,
        testCaseId: errorTestCases[index].id,
        topicId: topic.id,
      })),
    );

    // 4. Set run status to pending
    await this.runModel.update(runId, { status: 'pending' });

    return { retryCount: errorTopics.length };
  }

  async retrySingleCase(runId: string, testCaseId: string) {
    const run = await this.runModel.findById(runId);
    if (!run) throw new Error('Run not found');

    const runTopic = await this.runTopicModel.findByRunAndTestCase(runId, testCaseId);
    if (!runTopic) throw new Error('RunTopic not found');

    // 1. Delete old RunTopic
    await this.runTopicModel.deleteByRunAndTestCase(runId, testCaseId);

    // 2. Delete old Topic
    if (runTopic.topicId) {
      await this.topicModel.batchDelete([runTopic.topicId]);
    }

    // 3. Create new Topic
    const [newTopic] = await this.topicModel.batchCreate([
      {
        agentId: run.targetAgentId ?? undefined,
        title: `[Eval Case #${(runTopic.testCase?.sortOrder ?? 0) + 1}] ${runTopic.testCase?.content?.input?.slice(0, 50) || 'Test Case'}...`,
        trigger: 'eval',
      },
    ]);

    // 4. Create new RunTopic with pending status
    await this.runTopicModel.batchCreate([
      {
        runId,
        status: 'pending' as const,
        testCaseId,
        topicId: newTopic.id,
      },
    ]);

    // 5. Set run status to running
    await this.runModel.update(runId, { status: 'running' });
  }

  async loadTrajectoryData(runId: string, testCaseId: string) {
    const run = await this.runModel.findById(runId);
    if (!run) return { error: 'Run not found' as const };

    const testCase = await this.testCaseModel.findById(testCaseId);
    if (!testCase) return { error: 'Test case not found' as const };

    let envPrompt: string | undefined;
    if (run.datasetId) {
      const dataset = await this.datasetModel.findById(run.datasetId);
      envPrompt = dataset?.evalConfig?.envPrompt;
    }

    return { envPrompt, run, testCase };
  }

  async executeTrajectory(params: {
    envPrompt?: string;
    run: {
      config?: EvalRunConfig | null;
      datasetId: string;
      targetAgentId?: string | null;
    };
    runId: string;
    testCase: { content: { input?: string }; sortOrder?: number | null };
    testCaseId: string;
  }) {
    const { envPrompt, run, runId, testCaseId } = params;

    // Look up the pre-created RunTopic (created during createRun)
    const runTopic = await this.runTopicModel.findByRunAndTestCase(runId, testCaseId);
    if (!runTopic) {
      throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
    }

    const topicId = runTopic.topicId;

    // Update status from 'pending' to 'running'
    await this.runTopicModel.updateByRunAndTopic(runId, topicId, { status: 'running' });

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const webhookUrl = new URL(
      '/api/workflows/agent-eval-run/on-trajectory-complete',
      appEnv.APP_URL,
    ).toString();

    try {
      const execResult = await aiAgentService.execAgent({
        agentId: run.targetAgentId ?? undefined,
        appContext: { topicId },
        autoStart: true,
        completionWebhook: {
          body: { runId, testCaseId, userId: this.userId },
          url: webhookUrl,
        },
        ...(envPrompt && { evalContext: { envPrompt } }),
        maxSteps: run.config?.maxSteps,
        prompt: params.testCase.content.input || '',
        userInterventionConfig: { approvalMode: 'headless' },
      });

      if (execResult?.operationId) {
        await this.runTopicModel.updateByRunAndTopic(runId, topicId, {
          evalResult: { operationId: execResult.operationId, rubricScores: [] },
        });
      }

      return { topicId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Agent execution failed to start';
      console.error(
        `[run-agent-trajectory] execAgent failed for run=${runId} testCase=${testCaseId}:`,
        error,
      );

      await this.runTopicModel.updateByRunAndTopic(runId, topicId, {
        evalResult: { completionReason: 'error', error: errorMessage, rubricScores: [] },
        passed: false,
        score: 0,
        status: 'error',
      });

      return { error: errorMessage, topicId };
    }
  }

  /**
   * Execute a test case with K threads (for pass@k).
   * Creates K threads in the pre-existing topic, then triggers K run-thread-trajectory workflows.
   */
  async executeMultiThreadTrajectory(params: {
    k: number;
    run: {
      config?: EvalRunConfig | null;
      datasetId: string;
      targetAgentId?: string | null;
    };
    runId: string;
    testCaseId: string;
  }) {
    const { k, runId, testCaseId } = params;

    const runTopic = await this.runTopicModel.findByRunAndTestCase(runId, testCaseId);
    if (!runTopic) {
      throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
    }

    const topicId = runTopic.topicId;

    // Update status from 'pending' to 'running'
    await this.runTopicModel.updateByRunAndTopic(runId, topicId, { status: 'running' });

    // Create K threads in the topic
    const threadIds: string[] = [];
    for (let i = 0; i < k; i++) {
      const thread = await this.threadModel.create({
        topicId,
        type: 'eval',
      });
      if (thread) threadIds.push(thread.id);
    }

    // Trigger K run-thread-trajectory workflows in parallel
    await Promise.all(
      threadIds.map((threadId) =>
        AgentEvalRunWorkflow.triggerRunThreadTrajectory({
          runId,
          testCaseId,
          threadId,
          topicId,
          userId: this.userId,
        }),
      ),
    );

    return { threadIds, topicId };
  }

  /**
   * Execute a single thread trajectory (for pass@k).
   * Calls execAgent with topicId + threadId, webhook points to on-thread-complete.
   */
  async executeThreadTrajectory(params: {
    envPrompt?: string;
    run: {
      config?: EvalRunConfig | null;
      targetAgentId?: string | null;
    };
    runId: string;
    testCase: { content: { input?: string }; sortOrder?: number | null };
    testCaseId: string;
    threadId: string;
    topicId: string;
  }) {
    const { envPrompt, run, runId, testCaseId, threadId, topicId } = params;

    const aiAgentService = new AiAgentService(this.db, this.userId);
    const webhookUrl = new URL(
      '/api/workflows/agent-eval-run/on-thread-complete',
      appEnv.APP_URL,
    ).toString();

    try {
      const execResult = await aiAgentService.execAgent({
        agentId: run.targetAgentId ?? undefined,
        appContext: { threadId, topicId },
        autoStart: true,
        completionWebhook: {
          body: { runId, testCaseId, threadId, topicId, userId: this.userId },
          url: webhookUrl,
        },
        ...(envPrompt && { evalContext: { envPrompt } }),
        maxSteps: run.config?.maxSteps,
        prompt: params.testCase.content.input || '',
        userInterventionConfig: { approvalMode: 'headless' },
      });

      // Write operationId to thread metadata
      if (execResult?.operationId) {
        await this.threadModel.update(threadId, {
          metadata: { operationId: execResult.operationId, testCaseId },
        } as any);
      }

      return { threadId, topicId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Thread execution failed to start';
      console.error(
        `[run-thread-trajectory] execAgent failed for run=${runId} thread=${threadId}:`,
        error,
      );

      // Write error to thread metadata so it counts as "completed" for aggregation
      await this.threadModel.update(threadId, {
        metadata: {
          completedAt: new Date().toISOString(),
          error: errorMessage,
          passed: false,
          score: 0,
          testCaseId,
        },
      } as any);

      return { error: errorMessage, threadId, topicId };
    }
  }

  /**
   * Record a single thread's completion (for pass@k).
   * Evaluates the thread's messages, writes result to thread.metadata,
   * then checks if all K threads are done. If so, aggregates into RunTopic.
   */
  async recordThreadCompletion(params: {
    runId: string;
    status: string;
    telemetry: {
      completionReason?: string;
      cost?: number;
      duration?: number;
      errorMessage?: string;
      llmCalls?: number;
      steps?: number;
      toolCalls?: number;
      totalTokens?: number;
    };
    testCaseId: string;
    threadId: string;
    topicId: string;
  }): Promise<{ allRunDone: boolean; allThreadsDone: boolean }> {
    const { runId, testCaseId, threadId, topicId, telemetry, status } = params;

    // 1. Evaluate this thread's messages
    const evalResult = await this.evaluateThread({
      runId,
      status,
      telemetry,
      testCaseId,
      threadId,
      topicId,
    });

    // 2. Write eval result to thread.metadata
    await this.threadModel.update(threadId, {
      metadata: {
        ...evalResult,
        completedAt: new Date().toISOString(),
        testCaseId,
      },
    } as any);

    // 3. Check if all K threads for this topic are done
    const allThreads = await this.threadModel.queryByTopicId(topicId);
    const evalThreads = allThreads.filter((t) => t.type === 'eval');
    const completedThreads = evalThreads.filter((t) => {
      const meta = t.metadata as Record<string, unknown> | null;
      return meta && 'completedAt' in meta;
    });

    const allThreadsDone = completedThreads.length >= evalThreads.length;

    if (!allThreadsDone) {
      return { allRunDone: false, allThreadsDone: false };
    }

    // 4. All K threads done — aggregate into RunTopic
    await this.aggregateThreadResults({
      completedThreads: evalThreads,
      runId,
      testCaseId,
      topicId,
    });

    // 5. Check if the entire run is done (same as recordTrajectoryCompletion)
    const run = await this.runModel.findById(runId);
    if (!run) return { allRunDone: false, allThreadsDone: true };

    const totalCases = run.metrics?.totalCases;
    if (!totalCases) return { allRunDone: false, allThreadsDone: true };

    const allTopics = await this.runTopicModel.findByRunId(runId);
    const completedCount = allTopics.filter(
      (t) => (t.evalResult && 'completionReason' in t.evalResult) || t.status === 'timeout',
    ).length;

    // Update run metrics
    const passedCases = allTopics.filter((t) => t.status === 'passed').length;
    const failedCases = allTopics.filter((t) => t.status === 'failed').length;
    const errorCases = allTopics.filter((t) => t.status === 'error').length;
    const timeoutCases = allTopics.filter((t) => t.status === 'timeout').length;

    let sumCost = 0;
    let sumTokens = 0;
    let sumSteps = 0;
    let sumLlmCalls = 0;
    let sumToolCalls = 0;
    let actualTotalCost = 0;
    let actualTotalTokens = 0;
    let actualTotalDuration = 0;
    for (const t of allTopics) {
      const r = t.evalResult as Record<string, unknown> | null;
      if (r && ('completionReason' in r || t.status === 'timeout')) {
        if (typeof r.cost === 'number') sumCost += r.cost;
        if (typeof r.tokens === 'number') sumTokens += r.tokens;
        if (typeof r.steps === 'number') sumSteps += r.steps;
        if (typeof r.llmCalls === 'number') sumLlmCalls += r.llmCalls;
        if (typeof r.toolCalls === 'number') sumToolCalls += r.toolCalls;
        const rTotalCost =
          typeof r.totalCost === 'number' ? r.totalCost : typeof r.cost === 'number' ? r.cost : 0;
        const rTotalTokens =
          typeof r.totalTokens === 'number'
            ? r.totalTokens
            : typeof r.tokens === 'number'
              ? r.tokens
              : 0;
        const rTotalDuration =
          typeof r.totalDuration === 'number'
            ? r.totalDuration
            : typeof r.duration === 'number'
              ? r.duration
              : 0;
        actualTotalCost += rTotalCost;
        actualTotalTokens += rTotalTokens;
        actualTotalDuration += rTotalDuration;
      }
    }

    await this.runModel.update(runId, {
      metrics: {
        ...(run.metrics as EvalRunMetrics),
        completedCases: completedCount,
        cost: sumCost ? roundCost(sumCost) : undefined,
        errorCases,
        failedCases,
        llmCalls: sumLlmCalls || undefined,
        passedCases,
        perCaseCost: sumCost && completedCount ? roundCost(sumCost / completedCount) : undefined,
        perCaseLlmCalls:
          sumLlmCalls && completedCount
            ? Math.round((sumLlmCalls / completedCount) * 10) / 10
            : undefined,
        perCaseSteps:
          sumSteps && completedCount
            ? Math.round((sumSteps / completedCount) * 10) / 10
            : undefined,
        perCaseTokens:
          sumTokens && completedCount ? Math.round(sumTokens / completedCount) : undefined,
        perCaseToolCalls:
          sumToolCalls && completedCount
            ? Math.round((sumToolCalls / completedCount) * 10) / 10
            : undefined,
        steps: sumSteps || undefined,
        timeoutCases,
        tokens: sumTokens || undefined,
        toolCalls: sumToolCalls || undefined,
        totalCost: actualTotalCost ? roundCost(actualTotalCost) : undefined,
        totalDuration: actualTotalDuration || undefined,
        totalTokens: actualTotalTokens || undefined,
      },
    });

    return { allRunDone: completedCount >= totalCases, allThreadsDone: true };
  }

  /**
   * Evaluate a single thread's messages against rubrics.
   * Returns the eval result to write into thread.metadata.
   */
  private async evaluateThread(params: {
    runId: string;
    status: string;
    telemetry: {
      completionReason?: string;
      cost?: number;
      duration?: number;
      errorDetail?: unknown;
      errorMessage?: string;
      llmCalls?: number;
      steps?: number;
      toolCalls?: number;
      totalTokens?: number;
    };
    testCaseId: string;
    threadId: string;
    topicId: string;
  }): Promise<Record<string, unknown>> {
    const { runId, status, telemetry, testCaseId, threadId } = params;

    const baseMeta: Record<string, unknown> = {
      completionReason: telemetry.completionReason,
      cost: telemetry.cost != null ? roundCost(telemetry.cost) : undefined,
      duration: telemetry.duration,
      llmCalls: telemetry.llmCalls,
      steps: telemetry.steps,
      tokens: telemetry.totalTokens,
      toolCalls: telemetry.toolCalls,
    };

    // Error case — skip evaluation
    if (status === 'error') {
      return {
        ...baseMeta,
        error:
          telemetry.errorMessage || `Execution error: ${telemetry.completionReason || 'unknown'}`,
        errorDetail: telemetry.errorDetail,
        passed: false,
        score: 0,
      };
    }

    // Load run → dataset → benchmark for rubrics
    const run = await this.runModel.findById(runId);
    if (!run) return { ...baseMeta, error: 'Run not found', passed: false, score: 0 };

    const dataset = await this.datasetModel.findById(run.datasetId);
    if (!dataset) return { ...baseMeta, error: 'Dataset not found', passed: false, score: 0 };

    const benchmark = await this.benchmarkModel.findById(dataset.benchmarkId);
    if (!benchmark) return { ...baseMeta, error: 'Benchmark not found', passed: false, score: 0 };

    const testCase = await this.testCaseModel.findById(testCaseId);
    if (!testCase) return { ...baseMeta, error: 'Test case not found', passed: false, score: 0 };

    const passThreshold = (run.config?.passThreshold as number) ?? 0.6;

    // Get messages for this thread
    const messages = await this.messageModel.query({ threadId, topicId: params.topicId });
    const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
    const lastAssistantMsg = assistantMessages.at(-1);

    if (!lastAssistantMsg || !lastAssistantMsg.content) {
      return {
        ...baseMeta,
        error: 'No assistant output',
        passed: false,
        rubricScores: [],
        score: 0,
      };
    }

    // Resolve rubrics
    const evalMode = (testCase.evalMode ?? dataset.evalMode) as RubricType | null | undefined;
    const evalConfig = testCase.evalConfig ?? dataset.evalConfig;

    let effectiveRubrics: EvalBenchmarkRubric[];
    if (evalMode) {
      effectiveRubrics = [
        {
          config: (evalConfig ?? {}) as unknown as EvalBenchmarkRubric['config'],
          id: `eval-mode-${evalMode}`,
          name: evalMode,
          type: evalMode,
          weight: 1,
        },
      ];
    } else {
      effectiveRubrics = benchmark.rubrics ?? [];
    }

    // Run evaluation
    const result = await evaluate(
      { actual: lastAssistantMsg.content, rubrics: effectiveRubrics, testCase: testCase.content },
      { passThreshold },
    );

    return {
      ...baseMeta,
      passed: result.passed,
      rubricScores: result.rubricResults.map((r) => ({
        reason: r.reason,
        rubricId: r.rubricId,
        score: r.score,
      })),
      score: result.score,
    };
  }

  /**
   * Aggregate all completed thread results into RunTopic.
   * Writes threads[] array, plus top-level score/passed using pass@k logic.
   */
  private async aggregateThreadResults(params: {
    completedThreads: Array<{ id: string; metadata?: Record<string, unknown> | null }>;
    runId: string;
    testCaseId: string;
    topicId: string;
  }) {
    const { completedThreads, runId, topicId } = params;

    // Build threads array from metadata
    const threadResults: Array<{
      completionReason?: string;
      cost?: number;
      duration?: number;
      error?: string;
      llmCalls?: number;
      passed?: boolean;
      rubricScores?: Array<{ reason?: string; rubricId: string; score: number }>;
      score?: number;
      steps?: number;
      threadId: string;
      tokens?: number;
      toolCalls?: number;
    }> = completedThreads.map((t) => {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      return {
        completionReason: meta.completionReason as string | undefined,
        cost: meta.cost as number | undefined,
        duration: meta.duration as number | undefined,
        error: meta.error as string | undefined,
        llmCalls: meta.llmCalls as number | undefined,
        passed: meta.passed as boolean | undefined,
        rubricScores: meta.rubricScores as any,
        score: meta.score as number | undefined,
        steps: meta.steps as number | undefined,
        threadId: t.id,
        tokens: meta.tokens as number | undefined,
        toolCalls: meta.toolCalls as number | undefined,
      };
    });

    // pass@k: at least one thread passed
    const anyPassed = threadResults.some((t) => t.passed === true);
    // pass^k: all threads passed
    const allPassed = threadResults.every((t) => t.passed === true);

    // Best score (used as the representative score)
    const scores = threadResults.filter((t) => t.score != null).map((t) => t.score!);
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Aggregate metrics as totals across K threads
    let totalCost = 0;
    let totalDuration = 0;
    let totalTokens = 0;
    let totalSteps = 0;
    let totalLlmCalls = 0;
    let totalToolCalls = 0;
    for (const t of threadResults) {
      if (t.cost) totalCost += t.cost;
      if (t.duration) totalDuration += t.duration;
      if (t.tokens) totalTokens += t.tokens;
      if (t.steps) totalSteps += t.steps;
      if (t.llmCalls) totalLlmCalls += t.llmCalls;
      if (t.toolCalls) totalToolCalls += t.toolCalls;
    }

    // Compute per-case averages (primary fields = avg)
    const k = threadResults.length;

    // The topic-level completionReason: use "completed" if any succeeded
    const completionReason = anyPassed ? 'completed' : 'failed';

    // Write aggregated result to RunTopic
    // Primary fields (cost/tokens/duration/steps/llmCalls/toolCalls) = average per execution
    // total* fields = cumulative across K threads
    await this.runTopicModel.updateByRunAndTopic(runId, topicId, {
      evalResult: {
        completionReason,
        cost: totalCost ? roundCost(totalCost / k) : undefined,
        duration: totalDuration ? totalDuration / k : undefined,
        llmCalls: totalLlmCalls ? Math.round((totalLlmCalls / k) * 10) / 10 : undefined,
        passAllK: allPassed,
        passAtK: anyPassed,
        steps: totalSteps ? Math.round((totalSteps / k) * 10) / 10 : undefined,
        threads: threadResults,
        tokens: totalTokens ? totalTokens / k : undefined,
        toolCalls: totalToolCalls ? Math.round((totalToolCalls / k) * 10) / 10 : undefined,
        totalCost: totalCost ? roundCost(totalCost) : undefined,
        totalDuration: totalDuration || undefined,
        totalTokens: totalTokens || undefined,
      } satisfies EvalRunTopicResult,
      // pass@k: passed if any thread passed
      passed: anyPassed,
      score: bestScore,
      status: anyPassed ? 'passed' : 'failed',
    });
  }

  async getRunDetails(id: string) {
    let run = await this.runModel.findById(id);
    if (!run) return null;

    // Check if a 'running' run has timed out
    if (run.status === 'running') {
      const timedOut = await this.checkAndHandleRunTimeout(run);
      if (timedOut) {
        run = (await this.runModel.findById(id))!;
      }
    }

    // Get dataset and run topics in parallel
    const [dataset, runTopics] = await Promise.all([
      this.datasetModel.findById(run.datasetId),
      this.runTopicModel.findByRunId(id),
    ]);

    // Get target agent display info via AgentService (fallback for runs without snapshot)
    let targetAgent:
      | { avatar?: string; id: string; model?: string; provider?: string; title?: string }
      | undefined;
    if (run.targetAgentId) {
      const agentConfig = await this.agentService.getAgentConfigById(run.targetAgentId);
      if (agentConfig) {
        targetAgent = {
          avatar: agentConfig.avatar,
          id: run.targetAgentId,
          model: agentConfig.model,
          provider: agentConfig.provider,
          title: agentConfig.title,
        };
      }
    }

    return {
      ...run,
      dataset,
      targetAgent,
      topics: runTopics.map((rt) => ({
        createdAt: rt.createdAt,
        evalResult: rt.evalResult,
        passed: rt.passed,
        score: rt.score,
        status: rt.status,
        testCase: rt.testCase,
        testCaseId: rt.testCaseId,
        topic: rt.topic,
      })),
    };
  }

  async getAgentDisplayInfo(agentId: string) {
    const agentConfig = await this.agentService.getAgentConfigById(agentId);
    if (!agentConfig) return undefined;
    return {
      avatar: agentConfig.avatar,
      id: agentId,
      model: agentConfig.model,
      provider: agentConfig.provider,
      title: agentConfig.title,
    };
  }

  async recordTrajectoryCompletion(params: {
    runId: string;
    status?: string;
    telemetry: {
      completionReason?: string;
      cost?: number;
      duration?: number;
      errorDetail?: unknown;
      errorMessage?: string;
      llmCalls?: number;
      steps?: number;
      toolCalls?: number;
      totalTokens?: number;
    };
    testCaseId: string;
  }): Promise<{ allDone: boolean; completedCount: number }> {
    const { runId, testCaseId, telemetry, status } = params;

    // Write runtime telemetry to RunTopic
    const runTopic = await this.runTopicModel.findByRunAndTestCase(runId, testCaseId);
    if (runTopic) {
      // Skip if topic is already in a terminal state (e.g. timeout marked by checkAndHandleRunTimeout).
      // The interrupted agent still fires the completion webhook, but we must not overwrite the result.
      const terminalStates = ['passed', 'failed', 'error', 'timeout'];
      if (runTopic.status && terminalStates.includes(runTopic.status)) {
        // Fall through to progress tracking below without modifying this topic
      } else {
        // Build merged evalResult with telemetry data — use this as base for all subsequent writes
        const evalResultWithTelemetry: EvalRunTopicResult = {
          ...runTopic.evalResult,
          completionReason: telemetry.completionReason,
          cost: telemetry.cost != null ? roundCost(telemetry.cost) : undefined,
          duration: telemetry.duration,
          llmCalls: telemetry.llmCalls,
          rubricScores: runTopic.evalResult?.rubricScores,
          steps: telemetry.steps,
          tokens: telemetry.totalTokens,
          toolCalls: telemetry.toolCalls,
        };

        await this.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
          evalResult: evalResultWithTelemetry,
        });

        if (status === 'error') {
          // Short-circuit: execution error — skip evaluation, write error directly
          await this.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
            evalResult: {
              ...evalResultWithTelemetry,
              error:
                telemetry.errorMessage ||
                `Execution error: ${telemetry.completionReason || 'unknown'}`,
              errorDetail: telemetry.errorDetail,
            },
            passed: false,
            score: 0,
            status: 'error',
          });
        } else {
          // Per-case evaluation: immediately evaluate this case against rubrics
          try {
            await this.evaluateCase(runId, { ...runTopic, evalResult: evalResultWithTelemetry });
          } catch (e) {
            // Evaluation failure should not block telemetry or progress tracking
            console.error(e);
          }
        }
      }
    }

    // Get run to read totalCases
    const run = await this.runModel.findById(runId);
    if (!run) return { allDone: false, completedCount: 0 };

    const totalCases = run.metrics?.totalCases;
    if (!totalCases) return { allDone: false, completedCount: 0 };

    // Aggregate real-time metrics from all RunTopics
    const allTopics = await this.runTopicModel.findByRunId(runId);
    const completedCount = allTopics.filter(
      (t) => (t.evalResult && 'completionReason' in t.evalResult) || t.status === 'timeout',
    ).length;
    const passedCases = allTopics.filter((t) => t.status === 'passed').length;
    const failedCases = allTopics.filter((t) => t.status === 'failed').length;
    const errorCases = allTopics.filter((t) => t.status === 'error').length;
    const timeoutCases = allTopics.filter((t) => t.status === 'timeout').length;

    let sumCost = 0;
    let sumTokens = 0;
    let sumSteps = 0;
    let sumLlmCalls = 0;
    let sumToolCalls = 0;
    let actualTotalCost = 0;
    let actualTotalTokens = 0;
    let actualTotalDuration = 0;
    for (const t of allTopics) {
      const r = t.evalResult as Record<string, unknown> | null;
      if (r && ('completionReason' in r || t.status === 'timeout')) {
        if (typeof r.cost === 'number') sumCost += r.cost;
        if (typeof r.tokens === 'number') sumTokens += r.tokens;
        if (typeof r.steps === 'number') sumSteps += r.steps;
        if (typeof r.llmCalls === 'number') sumLlmCalls += r.llmCalls;
        if (typeof r.toolCalls === 'number') sumToolCalls += r.toolCalls;
        const rTotalCost =
          typeof r.totalCost === 'number' ? r.totalCost : typeof r.cost === 'number' ? r.cost : 0;
        const rTotalTokens =
          typeof r.totalTokens === 'number'
            ? r.totalTokens
            : typeof r.tokens === 'number'
              ? r.tokens
              : 0;
        const rTotalDuration =
          typeof r.totalDuration === 'number'
            ? r.totalDuration
            : typeof r.duration === 'number'
              ? r.duration
              : 0;
        actualTotalCost += rTotalCost;
        actualTotalTokens += rTotalTokens;
        actualTotalDuration += rTotalDuration;
      }
    }

    // Update run metrics with real-time counts
    await this.runModel.update(runId, {
      metrics: {
        ...(run.metrics as EvalRunMetrics),
        completedCases: completedCount,
        cost: sumCost ? roundCost(sumCost) : undefined,
        errorCases,
        failedCases,
        llmCalls: sumLlmCalls || undefined,
        passedCases,
        perCaseCost: sumCost && completedCount ? roundCost(sumCost / completedCount) : undefined,
        perCaseLlmCalls:
          sumLlmCalls && completedCount
            ? Math.round((sumLlmCalls / completedCount) * 10) / 10
            : undefined,
        perCaseSteps:
          sumSteps && completedCount
            ? Math.round((sumSteps / completedCount) * 10) / 10
            : undefined,
        perCaseTokens:
          sumTokens && completedCount ? Math.round(sumTokens / completedCount) : undefined,
        perCaseToolCalls:
          sumToolCalls && completedCount
            ? Math.round((sumToolCalls / completedCount) * 10) / 10
            : undefined,
        steps: sumSteps || undefined,
        timeoutCases,
        tokens: sumTokens || undefined,
        toolCalls: sumToolCalls || undefined,
        totalCost: actualTotalCost ? roundCost(actualTotalCost) : undefined,
        totalDuration: actualTotalDuration || undefined,
        totalTokens: actualTotalTokens || undefined,
      },
    });

    return { allDone: completedCount >= totalCases, completedCount };
  }

  async evaluateAndFinalizeRun(params: {
    run: {
      config?: EvalRunConfig | null;
      id: string;
      metrics?: EvalRunMetrics | null;
      startedAt?: Date | null;
    };
    runTopics: Array<{
      evalResult?: EvalRunTopicResult | null;
      passed?: boolean | null;
      runId: string;
      score?: number | null;
      status?: string | null;
      topicId: string;
    }>;
  }): Promise<EvalRunMetrics> {
    const { run, runTopics } = params;
    const k = run.config?.k ?? 1;

    let passedCases = 0;
    let failedCases = 0;
    let errorCases = 0;
    let timeoutCases = 0;
    let totalScore = 0;
    // Sum of per-case averages (for per-case display)
    let sumCost = 0;
    let sumTokens = 0;
    let sumSteps = 0;
    let sumLlmCalls = 0;
    let sumToolCalls = 0;
    // Actual cumulative totals across all K executions
    let actualTotalCost = 0;
    let actualTotalTokens = 0;
    let actualTotalDuration = 0;
    const rubricScoreAcc: Record<string, { count: number; sum: number }> = {};

    // pass@k / pass^k counters (only meaningful when k > 1)
    let passAtKCount = 0;
    let passAllKCount = 0;

    for (const runTopic of runTopics) {
      const existingResult = runTopic.evalResult;

      // Accumulate per-case averages (cost/tokens/steps/llmCalls/toolCalls are averages per execution)
      if (existingResult?.cost) sumCost += existingResult.cost;
      if (existingResult?.tokens) sumTokens += existingResult.tokens;
      if (existingResult?.steps) sumSteps += existingResult.steps;
      if (existingResult?.llmCalls) sumLlmCalls += existingResult.llmCalls;
      if (existingResult?.toolCalls) sumToolCalls += existingResult.toolCalls;

      // Accumulate actual totals (totalCost has K-thread cumulative, fallback to cost for K=1)
      actualTotalCost += existingResult?.totalCost ?? existingResult?.cost ?? 0;
      actualTotalTokens += existingResult?.totalTokens ?? existingResult?.tokens ?? 0;
      actualTotalDuration += existingResult?.totalDuration ?? existingResult?.duration ?? 0;

      // Count by status
      if (runTopic.status === 'passed') {
        passedCases++;
      } else if (runTopic.status === 'failed') {
        failedCases++;
      } else if (runTopic.status === 'error') {
        errorCases++;
      } else if (runTopic.status === 'timeout') {
        timeoutCases++;
      }

      // Only accumulate scores for evaluated (non-error, non-timeout) cases
      if (runTopic.status !== 'error' && runTopic.status !== 'timeout' && runTopic.score != null) {
        totalScore += runTopic.score;
      }

      // Accumulate per-rubric scores from existing evalResult (exclude error/timeout cases)
      if (
        runTopic.status !== 'error' &&
        runTopic.status !== 'timeout' &&
        existingResult?.rubricScores
      ) {
        for (const rs of existingResult.rubricScores) {
          if (!rubricScoreAcc[rs.rubricId]) {
            rubricScoreAcc[rs.rubricId] = { count: 0, sum: 0 };
          }
          rubricScoreAcc[rs.rubricId].sum += rs.score;
          rubricScoreAcc[rs.rubricId].count++;
        }
      }

      // pass@k / pass^k: derive from thread results when k > 1
      if (k > 1 && existingResult?.threads && existingResult.threads.length > 0) {
        const anyThreadPassed = existingResult.threads.some((t) => t.passed === true);
        const allThreadsPassed = existingResult.threads.every((t) => t.passed === true);
        if (anyThreadPassed) passAtKCount++;
        if (allThreadsPassed) passAllKCount++;
      }
    }

    const totalCases = runTopics.length;
    const evaluatedCases = passedCases + failedCases;
    const rubricScores: Record<string, number> = {};
    for (const [rubricId, acc] of Object.entries(rubricScoreAcc)) {
      rubricScores[rubricId] = acc.count > 0 ? acc.sum / acc.count : 0;
    }

    // Wall-clock duration: from startedAt (DB column, set when run enters 'running') to now
    const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : undefined;
    const wallClockDuration = startedAt ? Date.now() - startedAt : undefined;

    const metrics: EvalRunMetrics = {
      averageScore: evaluatedCases > 0 ? totalScore / evaluatedCases : 0,
      completedCases: totalCases,
      cost: sumCost ? roundCost(sumCost) : undefined,
      duration: wallClockDuration || undefined,
      errorCases,
      failedCases,
      llmCalls: sumLlmCalls || undefined,
      passRate: totalCases > 0 ? passedCases / totalCases : 0,
      passedCases,
      perCaseCost: sumCost && totalCases ? roundCost(sumCost / totalCases) : undefined,
      perCaseLlmCalls:
        sumLlmCalls && totalCases ? Math.round((sumLlmCalls / totalCases) * 10) / 10 : undefined,
      perCaseSteps:
        sumSteps && totalCases ? Math.round((sumSteps / totalCases) * 10) / 10 : undefined,
      perCaseTokens: sumTokens && totalCases ? Math.round(sumTokens / totalCases) : undefined,
      perCaseToolCalls:
        sumToolCalls && totalCases ? Math.round((sumToolCalls / totalCases) * 10) / 10 : undefined,
      rubricScores,
      steps: sumSteps || undefined,
      timeoutCases,
      tokens: sumTokens || undefined,
      toolCalls: sumToolCalls || undefined,
      totalCases,
      totalCost: actualTotalCost ? roundCost(actualTotalCost) : undefined,
      totalDuration: actualTotalDuration || undefined,
      totalTokens: actualTotalTokens || undefined,
    };

    // Add pass@k / pass^k only when k > 1
    if (k > 1) {
      metrics.passAtK = totalCases > 0 ? passAtKCount / totalCases : 0;
      metrics.passAllK = totalCases > 0 ? passAllKCount / totalCases : 0;
    }

    return metrics;
  }

  private async evaluateCase(
    runId: string,
    runTopic: {
      evalResult?: EvalRunTopicResult | null;
      runId: string;
      testCase?: { content?: any; evalConfig?: any; evalMode?: string | null } | null;
      topicId: string;
    },
  ) {
    // Resolve eval context: run → dataset → benchmark
    const run = await this.runModel.findById(runId);
    if (!run) return;

    const dataset = await this.datasetModel.findById(run.datasetId);
    if (!dataset) return;

    const benchmark = await this.benchmarkModel.findById(dataset.benchmarkId);
    if (!benchmark) return;

    const passThreshold = (run.config?.passThreshold as number) ?? 0.6;
    const benchmarkRubrics = benchmark.rubrics;

    // Get messages for this topic
    const messages = await this.messageModel.query({ topicId: runTopic.topicId });
    const assistantMessages = messages.filter((m: { role: string }) => m.role === 'assistant');
    const lastAssistantMsg = assistantMessages.at(-1);

    const existingResult = runTopic.evalResult;

    if (!lastAssistantMsg || !lastAssistantMsg.content) {
      await this.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
        evalResult: { ...existingResult, error: 'No assistant output', rubricScores: [] },
        passed: false,
        score: 0,
        status: 'error',
      });
      return;
    }

    const testCase = runTopic.testCase;
    if (!testCase) return;

    // Resolve rubrics: TestCase evalMode > Dataset evalMode > Benchmark rubrics
    const evalMode = (testCase.evalMode ?? dataset.evalMode) as RubricType | null | undefined;
    const evalConfig = testCase.evalConfig ?? dataset.evalConfig;

    let effectiveRubrics: EvalBenchmarkRubric[];
    if (evalMode) {
      effectiveRubrics = [
        {
          config: (evalConfig ?? {}) as unknown as EvalBenchmarkRubric['config'],
          id: `eval-mode-${evalMode}`,
          name: evalMode,
          type: evalMode,
          weight: 1,
        },
      ];
    } else {
      effectiveRubrics = benchmarkRubrics ?? [];
    }

    // No rubrics to evaluate against — skip evaluation entirely
    if (effectiveRubrics.length === 0) return;

    // Run evaluation
    const result = await evaluate(
      { actual: lastAssistantMsg.content, rubrics: effectiveRubrics, testCase: testCase.content },
      { passThreshold },
    );

    const evalResult: EvalRunTopicResult = {
      ...existingResult,
      rubricScores: result.rubricResults.map((r) => ({
        reason: r.reason,
        rubricId: r.rubricId,
        score: r.score,
      })),
    };

    // Write results to RunTopic
    await this.runTopicModel.updateByRunAndTopic(runTopic.runId, runTopic.topicId, {
      evalResult,
      passed: result.passed,
      score: result.score,
      status: result.passed ? 'passed' : 'failed',
    });
  }

  /**
   * Check each pending RunTopic individually against the per-case timeout.
   * If a topic's createdAt + timeout has elapsed, mark it as 'timeout' and write duration.
   * If all topics reach terminal state after this, finalize the run (aggregate metrics + mark completed).
   * Returns true if any state was changed.
   */
  async checkAndHandleRunTimeout(run: {
    config?: EvalRunConfig | null;
    id: string;
    metrics?: EvalRunMetrics | null;
    startedAt?: Date | null;
  }): Promise<boolean> {
    const perCaseTimeout = (run.config?.timeout as number) ?? 1_200_000; // 20 min default
    const now = Date.now();

    // Early exit: if run started less than timeout ago, no topic could have timed out
    if (run.startedAt && now - new Date(run.startedAt).getTime() < perCaseTimeout) {
      return false;
    }

    // Single SQL: mark pending topics where created_at + timeout < NOW() as 'timeout'
    const timedOutRows = await this.runTopicModel.batchMarkTimeout(run.id, perCaseTimeout);
    if (timedOutRows.length === 0) return false;

    // Interrupt running agents before writing timeout state (best-effort)
    const agentRuntimeService = new AgentRuntimeService(this.db, this.userId);
    for (const row of timedOutRows) {
      const opId = (row.evalResult as EvalRunTopicResult)?.operationId;
      if (opId) {
        try {
          await agentRuntimeService.interruptOperation(opId);
        } catch {
          // best effort — don't block timeout handling
        }
      }
    }

    // Write evalResult with duration for each timed-out topic
    for (const row of timedOutRows) {
      const duration = row.createdAt ? now - new Date(row.createdAt).getTime() : undefined;
      await this.runTopicModel.updateByRunAndTopic(row.runId, row.topicId, {
        evalResult: {
          ...(row.evalResult as EvalRunTopicResult),
          completionReason: 'timeout',
          duration,
          rubricScores: (row.evalResult as EvalRunTopicResult)?.rubricScores ?? [],
        },
        passed: false,
        score: 0,
      });
    }

    // Re-aggregate metrics from all RunTopics (including newly timed-out ones)
    const allTopics = await this.runTopicModel.findByRunId(run.id);
    const pendingCount = allTopics.filter(
      (t) => !t.status || t.status === 'pending' || t.status === 'running',
    ).length;

    if (pendingCount === 0) {
      // All topics in terminal state → finalize with full metrics
      const metrics = await this.evaluateAndFinalizeRun({
        run: { id: run.id, metrics: run.metrics, startedAt: run.startedAt },
        runTopics: allTopics,
      });

      const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
      const runStatus = nonSuccessCases >= metrics.totalCases ? 'failed' : 'completed';

      await this.runModel.update(run.id, { metrics, status: runStatus });
    } else {
      // Some topics still running → update real-time metrics so progress reflects timeouts
      const completedCount = allTopics.filter(
        (t) => (t.evalResult && 'completionReason' in t.evalResult) || t.status === 'timeout',
      ).length;
      const passedCases = allTopics.filter((t) => t.status === 'passed').length;
      const failedCases = allTopics.filter((t) => t.status === 'failed').length;
      const errorCases = allTopics.filter((t) => t.status === 'error').length;
      const timeoutCases = allTopics.filter((t) => t.status === 'timeout').length;

      await this.runModel.update(run.id, {
        metrics: {
          ...(run.metrics as EvalRunMetrics),
          completedCases: completedCount,
          errorCases,
          failedCases,
          passedCases,
          timeoutCases,
        },
      });
    }

    return true;
  }

  private async snapshotAgentConfig(agentId: string): Promise<EvalRunAgentSnapshot | undefined> {
    const agentConfig = await this.agentService.getAgentConfigById(agentId);
    if (!agentConfig) return undefined;

    return {
      avatar: agentConfig.avatar,
      chatConfig: agentConfig.chatConfig as unknown as Record<string, unknown>,
      description: null,
      fewShots: agentConfig.fewShots,
      model: agentConfig.model,
      params: agentConfig.params as Record<string, unknown>,
      plugins: agentConfig.plugins,
      provider: agentConfig.provider,
      systemRole: agentConfig.systemRole,
      title: agentConfig.title,
    };
  }
}
