import type { EvalRunInputConfig, RubricType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

class AgentEvalService {
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
    tags?: string[];
  }) {
    return lambdaClient.agentEval.createBenchmark.mutate(params);
  }

  async updateBenchmark(params: {
    description?: string;
    id: string;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
    tags?: string[];
  }) {
    return lambdaClient.agentEval.updateBenchmark.mutate(params);
  }

  async deleteBenchmark(id: string) {
    return lambdaClient.agentEval.deleteBenchmark.mutate({ id });
  }

  // ============ Dataset ============
  async listDatasets(benchmarkId: string) {
    return lambdaClient.agentEval.listDatasets.query({ benchmarkId });
  }

  async getDataset(id: string) {
    return lambdaClient.agentEval.getDataset.query({ id });
  }

  async createDataset(params: {
    benchmarkId: string;
    description?: string;
    evalConfig?: { judgePrompt?: string };
    evalMode?: RubricType;
    identifier: string;
    metadata?: Record<string, unknown>;
    name: string;
  }) {
    return lambdaClient.agentEval.createDataset.mutate(params);
  }

  async updateDataset(params: {
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
  async listTestCases(params: { datasetId: string; limit?: number; offset?: number }) {
    return lambdaClient.agentEval.listTestCases.query(params);
  }

  async createTestCase(params: {
    content: {
      category?: string;
      choices?: string[];
      expected?: string;
      input: string;
    };
    datasetId: string;
    evalConfig?: { judgePrompt?: string };
    evalMode?: RubricType;
    metadata?: {
      difficulty?: 'easy' | 'medium' | 'hard';
      tags?: string[];
    };
  }) {
    return lambdaClient.agentEval.createTestCase.mutate(params);
  }

  async updateTestCase(params: {
    id: string;
    content?: {
      category?: string;
      expected?: string;
      input: string;
    };
    evalConfig?: { judgePrompt?: string } | null;
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
  async listRuns(params: { benchmarkId?: string; datasetId?: string }) {
    return lambdaClient.agentEval.listRuns.query(params);
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
    name?: string;
    targetAgentId?: string;
  }) {
    return lambdaClient.agentEval.createRun.mutate(params);
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

  async retryRunCase(runId: string, testCaseId: string) {
    return lambdaClient.agentEval.retryRunCase.mutate({ runId, testCaseId });
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
