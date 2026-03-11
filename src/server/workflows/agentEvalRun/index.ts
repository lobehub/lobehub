import debug from 'debug';

import { AgentEvalRunTopicModel } from '@/database/models/agentEval';
import type { LobeChatDatabase } from '@/database/type';
import { workflowClient } from '@/libs/qstash';

const log = debug('lobe-server:workflows:agent-eval-run');

// Workflow paths
const WORKFLOW_PATHS = {
  executeTestCase: '/api/workflows/agent-eval-run/execute-test-case',
  finalizeRun: '/api/workflows/agent-eval-run/finalize-run',
  onThreadComplete: '/api/workflows/agent-eval-run/on-thread-complete',
  onTrajectoryComplete: '/api/workflows/agent-eval-run/on-trajectory-complete',
  paginateTestCases: '/api/workflows/agent-eval-run/paginate-test-cases',
  runAgentTrajectory: '/api/workflows/agent-eval-run/run-agent-trajectory',
  runBenchmark: '/api/workflows/agent-eval-run/run-benchmark',
  runThreadTrajectory: '/api/workflows/agent-eval-run/run-thread-trajectory',
} as const;

// Workflow payload types
export interface RunBenchmarkPayload {
  dryRun?: boolean;
  force?: boolean;
  runId: string;
  userId: string;
}

export interface PaginateTestCasesPayload {
  cursor?: string; // testCase.id
  runId: string;
  testCaseIds?: string[]; // For fanout chunks
  userId: string;
}

export interface ExecuteTestCasePayload {
  runId: string;
  testCaseId: string;
  userId: string;
}

export interface RunAgentTrajectoryPayload {
  runId: string;
  testCaseId: string;
  userId: string;
}

export interface FinalizeRunPayload {
  runId: string;
  userId: string;
}

export interface OnTrajectoryCompletePayload {
  cost?: number;
  duration?: number;
  errorDetail?: unknown;
  errorMessage?: string;
  llmCalls?: number;
  operationId: string;
  reason: string;
  runId: string;
  status: string;
  steps?: number;
  testCaseId: string;
  toolCalls?: number;
  totalTokens?: number;
  userId: string;
}

export interface RunThreadTrajectoryPayload {
  runId: string;
  testCaseId: string;
  threadId: string;
  topicId: string;
  userId: string;
}

export interface OnThreadCompletePayload {
  cost?: number;
  duration?: number;
  errorMessage?: string;
  llmCalls?: number;
  operationId: string;
  reason: string;
  runId: string;
  status: string;
  steps?: number;
  testCaseId: string;
  threadId: string;
  toolCalls?: number;
  topicId: string;
  totalTokens?: number;
  userId: string;
}

/**
 * Get workflow URL using APP_URL
 */
const getWorkflowUrl = (path: string): string => {
  const baseUrl = process.env.APP_URL;
  if (!baseUrl) throw new Error('APP_URL is required to trigger workflows');
  return new URL(path, baseUrl).toString();
};

/**
 * Agent Eval Run Workflow
 *
 * Handles workflow triggering for agent evaluation run execution.
 */
export class AgentEvalRunWorkflow {
  /**
   * Trigger workflow to run benchmark (entry point)
   */
  static triggerRunBenchmark(payload: RunBenchmarkPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.runBenchmark);
    log('Triggering run-benchmark workflow for run: %s', payload.runId);
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to paginate test cases
   */
  static triggerPaginateTestCases(payload: PaginateTestCasesPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.paginateTestCases);
    log('Triggering paginate-test-cases workflow for run: %s', payload.runId);
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to execute a test case K times
   */
  static triggerExecuteTestCase(payload: ExecuteTestCasePayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.executeTestCase);
    log(
      'Triggering execute-test-case workflow: run=%s, testCase=%s',
      payload.runId,
      payload.testCaseId,
    );
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to run a single agent trajectory
   */
  static triggerRunAgentTrajectory(payload: RunAgentTrajectoryPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.runAgentTrajectory);
    log(
      'Triggering run-agent-trajectory workflow: run=%s, testCase=%s',
      payload.runId,
      payload.testCaseId,
    );
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to run a single thread trajectory (for pass@k)
   */
  static triggerRunThreadTrajectory(payload: RunThreadTrajectoryPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.runThreadTrajectory);
    log(
      'Triggering run-thread-trajectory workflow: run=%s, testCase=%s, thread=%s',
      payload.runId,
      payload.testCaseId,
      payload.threadId,
    );
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Trigger workflow to finalize run
   */
  static triggerFinalizeRun(payload: FinalizeRunPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.finalizeRun);
    log('Triggering finalize-run workflow for run: %s', payload.runId);
    return workflowClient.trigger({ body: payload, url });
  }

  /**
   * Filter test cases that still need execution (RunTopic status='pending')
   * @returns Test case IDs that need execution
   */
  static async filterTestCasesNeedingExecution(
    db: LobeChatDatabase,
    params: { runId: string; testCaseIds: string[]; userId: string },
  ): Promise<string[]> {
    const { runId, testCaseIds, userId } = params;
    if (testCaseIds.length === 0) return [];

    const agentEvalRunTopicModel = new AgentEvalRunTopicModel(db, userId);

    // Get existing RunTopics for this run
    const existingRunTopics = await agentEvalRunTopicModel.findByRunId(runId);

    // Build a set of test case IDs whose RunTopic is in 'pending' status
    const pendingTestCaseIds = new Set(
      existingRunTopics
        .filter((rt) => rt.status === 'pending')
        .map((rt: { testCaseId: string }) => rt.testCaseId),
    );

    // Return only test cases that are still pending
    return testCaseIds.filter((id) => pendingTestCaseIds.has(id));
  }
}
