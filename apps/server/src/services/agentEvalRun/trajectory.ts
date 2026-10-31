import type { EvalCaseEnvironment, EvalRunConfig, EvalTestCaseMetadata } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { AiAgentService } from '@/server/services/aiAgent';

import { recordTrajectoryCompletion } from './completion';
import {
  EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
  EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
} from './constants';
import { createRunTopics } from './createRun';
import { createEvalRunDeps } from './deps';
import type { EvalRunDeps } from './types';
import { getCaseId, getEvalContextParams } from './utils';

export async function loadTrajectoryData(deps: EvalRunDeps, runId: string, testCaseId: string) {
  const run = await deps.runModel.findById(runId);
  if (!run) return { error: 'Run not found' as const };

  const testCase = await deps.testCaseModel.findById(testCaseId);
  if (!testCase) return { error: 'Test case not found' as const };

  let envPrompt: string | undefined;
  let environment: EvalCaseEnvironment | undefined;
  if (run.datasetId) {
    const dataset = await deps.datasetModel.findById(run.datasetId);
    envPrompt = dataset?.evalConfig?.envPrompt;
    environment = testCase.content.environment;
  }

  return { envPrompt, environment, run, testCase };
}

export async function executeTrajectory(
  deps: EvalRunDeps,
  params: {
    envPrompt?: string;
    run: {
      config?: EvalRunConfig | null;
      datasetId: string;
      targetAgentId?: string | null;
    };
    runId: string;
    testCase: {
      content: { input?: string };
      metadata?: EvalTestCaseMetadata | null;
      sortOrder?: number | null;
    };
    testCaseId: string;
    environment?: EvalCaseEnvironment;
  },
) {
  const { runId, testCaseId } = params;

  // Look up the pre-created RunTopic (created during createRun)
  const runTopic = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (!runTopic) {
    throw new Error(`RunTopic not found for run=${runId} testCase=${testCaseId}`);
  }

  return executeTrajectoryCore(deps, { ...params, topicId: runTopic.topicId });
}

/**
 * Shared trajectory execution once the target topic is known. Marks the
 * RunTopic running and starts the agent via execAgent.
 */
async function executeTrajectoryCore(
  deps: EvalRunDeps,
  params: {
    /** Route execution to an enrolled device (native AgentRuntime). */
    deviceId?: string;
    envPrompt?: string;
    run: {
      config?: EvalRunConfig | null;
      datasetId: string;
      targetAgentId?: string | null;
    };
    runId: string;
    testCase: {
      content: { input?: string };
      metadata?: EvalTestCaseMetadata | null;
      sortOrder?: number | null;
    };
    testCaseId: string;
    topicId: string;
    environment?: EvalCaseEnvironment;
  },
) {
  const { envPrompt, environment, run, runId, testCaseId, topicId } = params;
  const caseId = getCaseId(params.testCase.metadata);

  // Update status from 'pending' to 'running'
  await deps.runTopicModel.updateByRunAndTopic(runId, topicId, { status: 'running' });

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });
  const webhookUrl = '/api/workflows/agent-eval-run/on-trajectory-complete';
  const userId = deps.userId;
  const db = deps.db;

  try {
    const execResult = await aiAgentService.execAgent({
      agentId: run.targetAgentId ?? undefined,
      appContext: { topicId },
      autoStart: true,
      ...(params.deviceId && { deviceId: params.deviceId }),
      trigger: RequestTrigger.Eval,
      hooks: [
        {
          handler: async (event) => {
            // Local mode: directly record completion
            await recordTrajectoryCompletion(createEvalRunDeps(db, userId, deps.workspaceId), {
              runId,
              status: event.status || event.reason || 'done',
              telemetry: {
                completionReason: event.reason,
                cost: event.cost,
                duration: event.duration,
                errorDetail: event.errorDetail,
                errorMessage: event.errorMessage,
                llmCalls: event.llmCalls,
                steps: event.steps,
                toolCalls: event.toolCalls,
                totalTokens: event.totalTokens,
              },
              testCaseId,
            });
          },
          id: 'eval-trajectory-complete',
          type: 'onComplete' as const,
          webhook: {
            body: { runId, testCaseId, userId },
            delivery: 'qstash' as const,
            url: webhookUrl,
          },
        },
      ],
      ...getEvalContextParams(envPrompt, environment, caseId),
      maxSteps: run.config?.maxSteps,
      prompt: params.testCase.content.input || '',
      queueRetries: EVAL_AGENT_RUNTIME_QSTASH_RETRIES,
      queueRetryDelay: EVAL_AGENT_RUNTIME_QSTASH_RETRY_DELAY,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    if (execResult?.operationId) {
      await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
        evalResult: { operationId: execResult.operationId, rubricScores: [] },
      });
    }

    return { operationId: execResult?.operationId, topicId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent execution failed to start';
    console.error(
      `[run-agent-trajectory] execAgent failed for run=${runId} testCase=${testCaseId}:`,
      error,
    );

    await deps.runTopicModel.updateByRunAndTopic(runId, topicId, {
      evalResult: { completionReason: 'error', error: errorMessage, rubricScores: [] },
      passed: false,
      score: 0,
      status: 'error',
    });

    return { error: errorMessage, topicId };
  }
}

/**
 * Atomically claim a pending external run (pending -> running) and return
 * everything a worker needs: the run, its dataset, all test cases (each
 * exposing the dataset-native `metadata.caseId`), and the agent snapshot.
 * Throws when the run is not owned or not currently pending.
 */
export async function claimRun(deps: EvalRunDeps, runId: string) {
  const run = await deps.runModel.claim(runId);
  if (!run) throw new Error('Run is not pending or already claimed');

  const [dataset, testCases] = await Promise.all([
    deps.datasetModel.findById(run.datasetId),
    deps.testCaseModel.findByDatasetId(run.datasetId),
  ]);

  return {
    agentSnapshot: (run.config as EvalRunConfig | null)?.agentSnapshot,
    dataset: dataset
      ? {
          evalConfig: dataset.evalConfig,
          id: dataset.id,
          identifier: dataset.identifier,
          metadata: dataset.metadata,
          name: dataset.name,
        }
      : undefined,
    run,
    testCases: testCases.map((tc) => ({
      content: tc.content,
      id: tc.id,
      metadata: tc.metadata,
      sortOrder: tc.sortOrder,
    })),
  };
}

/**
 * External worker entry point: execute a single case of a claimed run by its
 * dataset-native `metadata.caseId` (falling back to the internal test case
 * id). Creates the Topic/RunTopic on demand (external runs pre-create none),
 * then runs the trajectory. Idempotent for terminal cases — the old RunTopic
 * association is replaced with a fresh Topic; an active case is rejected.
 */
export async function executeTrajectoryOnDemand(
  deps: EvalRunDeps,
  params: {
    caseId: string;
    /** Route execution to an enrolled device (native AgentRuntime). */
    deviceId?: string;
    prompt?: string;
    runId: string;
  },
) {
  const { runId, caseId } = params;

  const run = await deps.runModel.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status !== 'running') {
    throw new Error(`Run is not running (status=${run.status}); claim it first`);
  }
  if (((run.config as EvalRunConfig | null)?.k ?? 1) > 1) {
    throw new Error('External execution only supports k=1');
  }

  // Resolve the dataset-native caseId to an internal test case.
  let testCase = await deps.testCaseModel.findByDatasetIdAndCaseId(run.datasetId, caseId);
  if (!testCase) {
    const byId = await deps.testCaseModel.findById(caseId);
    if (byId && byId.datasetId === run.datasetId) testCase = byId;
  }
  if (!testCase) throw new Error(`Test case not found for caseId=${caseId}`);

  const testCaseId = testCase.id;
  const dataset = await deps.datasetModel.findById(run.datasetId);
  const envPrompt = dataset?.evalConfig?.envPrompt;
  const environment = testCase.content.environment;

  // Idempotent re-run of a terminal case: drop only the old RunTopic
  // association (the old Topic is preserved) and link a fresh one.
  const existing = await deps.runTopicModel.findByRunAndTestCase(runId, testCaseId);
  if (existing) {
    if (existing.status === 'running' || existing.status === 'pending') {
      throw new Error(`Case ${caseId} is already active for this run`);
    }
    await deps.runTopicModel.deleteByRunAndTestCase(runId, testCaseId);
  }

  const topicId = (
    await createRunTopics(deps, runId, run.targetAgentId, [
      { content: testCase.content, id: testCaseId, sortOrder: testCase.sortOrder },
    ])
  )[0]!;

  const result = await executeTrajectoryCore(deps, {
    deviceId: params.deviceId,
    envPrompt,
    run: { config: run.config, datasetId: run.datasetId, targetAgentId: run.targetAgentId },
    runId,
    testCase: {
      content: { ...testCase.content, input: params.prompt ?? testCase.content.input },
      metadata: testCase.metadata,
      sortOrder: testCase.sortOrder,
    },
    testCaseId,
    topicId,
    environment,
  });

  return { ...result, testCaseId };
}
