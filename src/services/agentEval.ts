import type {
  AgentEvalDatasetPackageBindings,
  AgentEvalRunListItem,
  EvalCaseEnvironment,
  EvalConfig,
  EvalRunInputConfig,
  EvalTestCaseContent,
  RubricType,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentEvalService {
  // ============ Experiment ============
  async listExperiments() {
    return lambdaClient.agentEval.listExperiments.query();
  }

  async getExperiment(id: string) {
    return lambdaClient.agentEval.getExperiment.query({ id });
  }

  async createExperiment(params: {
    benchmarkIds: string[];
    description?: string;
    /** Caller-supplied id: creating again with the same id returns the existing experiment. */
    id?: string;
    metadata?: Record<string, unknown>;
    name: string;
  }) {
    return lambdaClient.agentEval.createExperiment.mutate(params);
  }

  async updateExperiment(params: {
    benchmarkIds?: string[];
    description?: string;
    id: string;
    metadata?: Record<string, unknown>;
    name?: string;
  }) {
    return lambdaClient.agentEval.updateExperiment.mutate(params);
  }

  /** `withRuns` deletes the experiment's runs (results, topics, case Agents) with it. */
  async deleteExperiment(id: string, options?: { withRuns?: boolean }) {
    return lambdaClient.agentEval.deleteExperiment.mutate({ id, ...options });
  }

  // ============ Benchmark ============
  async listBenchmarks() {
    return lambdaClient.agentEval.listBenchmarks.query();
  }

  async getBenchmark(id: string) {
    return lambdaClient.agentEval.getBenchmark.query({ id });
  }

  async createBenchmark(params: {
    description?: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    rubrics?: any[];
  }) {
    return lambdaClient.agentEval.createBenchmark.mutate(params);
  }

  async updateBenchmark(params: {
    description?: string;
    id: string;
    metadata?: Record<string, unknown>;
    name: string;
  }) {
    return lambdaClient.agentEval.updateBenchmark.mutate(params);
  }

  async deleteBenchmark(id: string) {
    return lambdaClient.agentEval.deleteBenchmark.mutate({ id });
  }

  // ============ Dataset ============
  // ============================================
  // Environments
  // ============================================
  async listEvalConnectors(datasetId: string) {
    return lambdaClient.agentEval.listEvalConnectors.query({ datasetId });
  }

  async getEvalConnector(datasetId: string, id: string) {
    return lambdaClient.agentEval.getEvalConnector.query({ datasetId, id });
  }

  async saveEvalConnector(params: {
    datasetId: string;
    id?: string;
    isEnabled?: boolean;
    name: string;
    mcpServerUrl: string;
    credentials?:
      | { type: 'bearer'; token: string }
      | { type: 'header'; headers: Record<string, string> }
      | null;
  }) {
    return params.id
      ? lambdaClient.agentEval.updateEvalConnector.mutate({ ...params, id: params.id })
      : lambdaClient.agentEval.createEvalConnector.mutate(params);
  }

  async testEvalConnector(datasetId: string, id: string) {
    return lambdaClient.agentEval.testEvalConnector.mutate({ datasetId, id });
  }

  async getDatasetConnectorBindings(datasetId: string) {
    return lambdaClient.agentEval.getDatasetConnectorBindings.query({ datasetId });
  }

  async updateDatasetConnectorBindings(
    params: AgentEvalDatasetPackageBindings & { datasetId: string },
  ) {
    return lambdaClient.agentEval.updateDatasetConnectorBindings.mutate(params);
  }

  async listEnvironments() {
    return lambdaClient.agentEval.listEnvironments.query();
  }

  async getEnvironment(id: string) {
    return lambdaClient.agentEval.getEnvironment.query({ id });
  }

  async createEnvironment(params: {
    config: EvalCaseEnvironment;
    description?: string;
    identifier?: string;
    metadata?: Record<string, unknown>;
    name: string;
  }) {
    return lambdaClient.agentEval.createEnvironment.mutate(params);
  }

  async updateEnvironment(params: {
    config?: EvalCaseEnvironment;
    description?: string | null;
    id: string;
    identifier?: string | null;
    metadata?: Record<string, unknown> | null;
    name?: string;
  }) {
    return lambdaClient.agentEval.updateEnvironment.mutate(params);
  }

  async deleteEnvironment(id: string) {
    return lambdaClient.agentEval.deleteEnvironment.mutate({ id });
  }

  async listDatasets(benchmarkId: string) {
    return lambdaClient.agentEval.listDatasets.query({ benchmarkId });
  }

  /** Every dataset, whether or not it belongs to a benchmark. */
  async listAllDatasets() {
    return lambdaClient.agentEval.listDatasets.query({});
  }

  async getDataset(id: string) {
    return lambdaClient.agentEval.getDataset.query({ id });
  }

  async createDataset(params: {
    cases?: Array<{
      content: EvalTestCaseContent;
      environmentId?: string | null;
      evalConfig?: EvalConfig;
      evalMode?: RubricType;
      metadata?: Record<string, unknown>;
      sortOrder?: number;
    }>;
    benchmarkId: string;
    description?: string;
    evalConfig?: { judgePrompt?: string };
    evalMode?: RubricType;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    sourceExperimentId?: string;
  }) {
    return lambdaClient.agentEval.createDataset.mutate(params);
  }

  async updateDataset(params: {
    /** Moves the dataset into this benchmark (one the account can see). */
    benchmarkId?: string;
    description?: string;
    evalConfig?: { judgePrompt?: string } | null;
    evalMode?: RubricType | null;
    id: string;
    metadata?: Record<string, unknown>;
    name: string;
  }) {
    return lambdaClient.agentEval.updateDataset.mutate(params);
  }

  async deleteDataset(id: string) {
    return lambdaClient.agentEval.deleteDataset.mutate({ id });
  }

  async parseDatasetFile(params: { filename?: string; pathname: string }) {
    return lambdaClient.agentEval.parseDatasetFile.mutate(params);
  }

  async importDatasetPackage(
    params: AgentEvalDatasetPackageBindings & {
      benchmarkId?: string;
      datasetId?: string;
      filename?: string;
      name?: string;
      pathname: string;
    },
  ) {
    return lambdaClient.agentEval.importDatasetPackage.mutate(params);
  }

  async importDataset(params: {
    datasetId: string;
    pathname: string;
    filename?: string;
    format?: 'json' | 'jsonl' | 'csv' | 'xlsx';
    fieldMapping: {
      input: string;
      expected?: string;
      expectedDelimiter?: string;
      category?: string;
      choices?: string;
      metadata?: Record<string, string>;
      sortOrder?: string;
    };
  }) {
    return lambdaClient.agentEval.importDataset.mutate(params);
  }

  // ============ Test Case ============
  async getTestCase(id: string) {
    return lambdaClient.agentEval.getTestCase.query({ id });
  }

  async draftTestCaseFromTopic(params: {
    benchmarkId?: string;
    draftRules?: boolean;
    topicId: string;
  }) {
    return lambdaClient.agentEval.draftTestCaseFromTopic.mutate(params);
  }

  async listTestCases(params: { datasetId: string; limit?: number; offset?: number }) {
    return lambdaClient.agentEval.listTestCases.query(params);
  }

  async createTestCase(params: {
    environmentId?: string | null;
    content: {
      category?: string;
      choices?: string[];
      environment?: EvalCaseEnvironment;
      expected?: string;
      input: string;
      /**
       * Conversation replayed into the eval topic before `input` is sent. The
       * router has always accepted it; this client had not exposed it.
       */
      messages?: EvalTestCaseContent['messages'];
    };
    datasetId: string;
    evalConfig?: { criteria?: string; judgePrompt?: string };
    evalMode?: RubricType;
    metadata?: Record<string, unknown>;
  }) {
    return lambdaClient.agentEval.createTestCase.mutate(params);
  }

  /** Creates several cases at once, each with its own rules and judge (a dataset's copies). */
  async batchCreateTestCases(params: {
    cases: Array<{
      content: { input: string } & Record<string, unknown>;
      environmentId?: string | null;
      evalConfig?: Record<string, unknown>;
      evalMode?: RubricType;
      metadata?: Record<string, unknown>;
      sortOrder?: number;
    }>;
    datasetId: string;
  }) {
    return lambdaClient.agentEval.batchCreateTestCases.mutate(params as never);
  }

  async updateTestCase(params: {
    environmentId?: string | null;
    id: string;
    content?: {
      category?: string;
      choices?: string[];
      environment?: EvalCaseEnvironment;
      expected?: string;
      input?: string;
      messages?: EvalTestCaseContent['messages'];
    };
    evalConfig?: { criteria?: string; judgePrompt?: string } | null;
    evalMode?: RubricType | null;
    metadata?: Record<string, unknown>;
    sortOrder?: number;
  }) {
    return lambdaClient.agentEval.updateTestCase.mutate(params);
  }

  async deleteTestCase(id: string) {
    return lambdaClient.agentEval.deleteTestCase.mutate({ id });
  }

  // ============ Run ============
  async listRuns(params: {
    benchmarkId?: string;
    datasetId?: string;
    experimentId?: string;
    limit?: number;
    offset?: number;
  }) {
    return lambdaClient.agentEval.listRuns.query(params);
  }

  /** Complete run list for summaries and actions that must cover every run. */
  async listAllRuns(params: { benchmarkId?: string; datasetId?: string; experimentId?: string }) {
    const runs = new Map<string, AgentEvalRunListItem>();
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const { data } = await this.listRuns({ ...params, limit, offset });
      // Concurrent inserts can shift an offset boundary between requests.
      for (const run of data) runs.set(run.id, run);
      // listRuns.total currently counts this page, not all matching runs.
      if (data.length < limit) return [...runs.values()];
    }
  }

  async getRunDetails(id: string) {
    return lambdaClient.agentEval.getRunDetails.query({ id });
  }

  async getRunResults(id: string) {
    return lambdaClient.agentEval.getRunResults.query({ id });
  }

  async createRun(params: {
    config?: EvalRunInputConfig;
    datasetId: string;
    experimentId?: string;
    /** Caller-supplied id: creating again with the same id and parameters returns the existing run. */
    id?: string;
    name?: string;
    parentRunId?: string;
    targetAgentId?: string;
  }) {
    return lambdaClient.agentEval.createRun.mutate(params);
  }

  /** Which of these providers this server can call for the current user (key present). */
  async checkProviders(providers: string[]) {
    return lambdaClient.agentEval.checkProviders.query({ providers });
  }

  async startRun(id: string, force?: boolean) {
    return lambdaClient.agentEval.startRun.mutate({ force, id });
  }

  async abortRun(id: string) {
    return lambdaClient.agentEval.abortRun.mutate({ id });
  }

  async retryRunErrors(id: string) {
    return lambdaClient.agentEval.retryRunErrors.mutate({ id });
  }

  /** Grade a finished run again from its recorded trajectories; nothing is re-run. */
  async rejudgeRun(id: string) {
    return lambdaClient.agentEval.rejudgeRun.mutate({ id });
  }

  async rerunRunUnverified(id: string) {
    return lambdaClient.agentEval.rerunRunUnverified.mutate({ id });
  }

  async retryRunCase(runId: string, testCaseId: string) {
    return lambdaClient.agentEval.retryRunCase.mutate({ runId, testCaseId });
  }

  async resumeRunCase(runId: string, testCaseId: string, threadId?: string) {
    return lambdaClient.agentEval.resumeRunCase.mutate({ runId, testCaseId, threadId });
  }

  async batchResumeRunCases(
    runId: string,
    targets: Array<{ testCaseId: string; threadId?: string }>,
  ) {
    return lambdaClient.agentEval.batchResumeRunCases.mutate({ runId, targets });
  }

  async getResumableCases(runId: string) {
    return lambdaClient.agentEval.getResumableCases.query({ runId });
  }

  async updateRun(params: {
    config?: EvalRunInputConfig;
    datasetId?: string;
    id: string;
    name?: string;
    targetAgentId?: string | null;
  }) {
    return lambdaClient.agentEval.updateRun.mutate(params);
  }

  async deleteRun(id: string) {
    return lambdaClient.agentEval.deleteRun.mutate({ id });
  }
}

export const agentEvalService = new AgentEvalService();
