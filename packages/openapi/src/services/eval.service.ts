import type { EvalRunTopicResult } from '@lobechat/types';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import type { AgentEvalRunItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { AgentEvalRunService, RUN_CREATE_ID_CONFLICT } from '@/server/services/agentEvalRun';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { BaseService } from '../common/base.service';
import type {
  CreateEvalRunRequest,
  EvalRunResponse,
  EvalRunResultsResponse,
} from '../types/eval.type';

const projectRun = (run: AgentEvalRunItem): EvalRunResponse => ({
  createdAt: run.createdAt,
  datasetId: run.datasetId,
  id: run.id,
  metrics: run.metrics,
  name: run.name,
  startedAt: run.startedAt,
  status: run.status,
  targetAgentId: run.targetAgentId,
  updatedAt: run.updatedAt,
});

const projectResult = (value: EvalRunTopicResult | null): EvalRunTopicResult | null => {
  if (!value) return null;
  return {
    awaitingExternalEval: value.awaitingExternalEval,
    completionReason: value.completionReason,
    cost: value.cost,
    duration: value.duration,
    error: value.error,
    extractedAnswer: value.extractedAnswer,
    llmCalls: value.llmCalls,
    passAllK: value.passAllK,
    passAtK: value.passAtK,
    rubricScores: value.rubricScores,
    steps: value.steps,
    threads: value.threads?.map((thread) => ({
      completionReason: thread.completionReason,
      cost: thread.cost,
      duration: thread.duration,
      error: thread.error,
      llmCalls: thread.llmCalls,
      passed: thread.passed,
      rubricScores: thread.rubricScores,
      score: thread.score,
      status: thread.status,
      steps: thread.steps,
      threadId: thread.threadId,
      tokens: thread.tokens,
      toolCalls: thread.toolCalls,
    })),
    tokens: value.tokens,
    toolCalls: value.toolCalls,
    totalCost: value.totalCost,
    totalDuration: value.totalDuration,
    totalTokens: value.totalTokens,
  };
};

export class EvalService extends BaseService {
  private runModel: AgentEvalRunModel;
  private runService: AgentEvalRunService;
  private runTopicModel: AgentEvalRunTopicModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.runModel = new AgentEvalRunModel(db, userId, workspaceId);
    this.runService = new AgentEvalRunService(db, userId, workspaceId);
    this.runTopicModel = new AgentEvalRunTopicModel(db, userId, workspaceId);
  }

  async createRun(request: CreateEvalRunRequest): Promise<EvalRunResponse> {
    let run: AgentEvalRunItem;
    try {
      run = await this.runService.createRun({ ...request, mode: 'internal' });
    } catch (error) {
      if (error instanceof Error && error.message === RUN_CREATE_ID_CONFLICT) {
        throw this.createConflictError('Eval run id already exists with different parameters');
      }
      throw this.createBusinessError(
        error instanceof Error ? error.message : 'Failed to create eval run',
      );
    }

    // queue() is conditional idle -> pending. An idempotent retry sees the
    // existing pending/running/terminal run and does not dispatch twice.
    const queued = await this.runModel.queue(run.id);
    if (queued) {
      try {
        await AgentEvalRunWorkflow.triggerRunBenchmark({ runId: run.id, userId: this.userId });
      } catch (error) {
        await this.runModel.update(run.id, { status: 'idle' });
        throw this.createBusinessError(
          `Failed to queue eval run: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      run = queued;
    }

    return projectRun(run);
  }

  async getRun(id: string): Promise<EvalRunResponse> {
    // getRunDetails also applies the existing timeout reconciliation logic.
    const detail = await this.runService.getRunDetails(id);
    if (!detail) throw this.createNotFoundError('Eval run not found');
    return projectRun(detail);
  }

  async getRunResults(id: string): Promise<EvalRunResultsResponse> {
    const run = await this.runModel.findById(id);
    if (!run) throw this.createNotFoundError('Eval run not found');
    const topics = await this.runTopicModel.findByRunId(id);

    return {
      results: topics.map((topic) => ({
        createdAt: topic.createdAt,
        input: topic.testCase?.content.input ?? '',
        passed: topic.passed,
        result: projectResult(topic.evalResult),
        score: topic.score,
        status: topic.status,
        testCaseId: topic.testCaseId,
        topicId: topic.topicId,
      })),
      runId: id,
      total: topics.length,
    };
  }
}
