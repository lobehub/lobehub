import type { EvalRunConfig, EvalRunMetrics, EvalRunTopicResult } from './agentEval';
import type { AgentEvalDataset } from './agentEvalDataset';

// ============================================
// Run Entity Types
// ============================================

export type AgentEvalRunStatus =
  | 'aborted'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'pending'
  | 'running';

export interface AgentEvalRunTargetAgent {
  avatar?: string;
  id: string;
  model?: string;
  provider?: string;
  title?: string;
}

/**
 * Full run entity (for detail pages)
 * Contains all fields including heavy data like config and metrics
 */
export interface AgentEvalRun {
  config?: EvalRunConfig | null;
  createdAt: Date;
  datasetId: string;
  id: string;
  metrics?: EvalRunMetrics | null;
  name?: string | null;
  status: AgentEvalRunStatus;
  targetAgentId?: string | null;
  updatedAt: Date;
  userId: string;
}

/**
 * Lightweight run item (for list display)
 * Excludes heavy fields like full config, may include summary metrics
 */
export interface AgentEvalRunListItem {
  averageScore?: number;
  completedCases?: number;
  config?: EvalRunConfig | null;
  createdAt: Date;
  datasetId: string;
  datasetName?: string;
  errorCount?: number;
  failCount?: number;
  id: string;
  metrics?: EvalRunMetrics | null;
  name?: string | null;
  passCount?: number;
  passRate?: number;
  status: AgentEvalRunStatus;
  targetAgent?: AgentEvalRunTargetAgent;
  targetAgentId?: string | null;
  totalCases?: number;
  totalCost?: number;
  totalDuration?: number;
  updatedAt: Date;
  userId?: string;
}

export interface AgentEvalRunDetail extends AgentEvalRun {
  dataset?: AgentEvalDataset | null;
  targetAgent?: AgentEvalRunTargetAgent;
  topics?: AgentEvalRunTopicResult[];
}

export interface AgentEvalRunTopicResult {
  createdAt?: Date | null;
  evalResult?: EvalRunTopicResult | null;
  passed?: boolean | null;
  score?: number | null;
  status?: string | null;
  testCase?: any;
  testCaseId: string;
  topic?: any;
  topicId: string;
}

export interface AgentEvalRunResults {
  results: AgentEvalRunTopicResult[];
  runId: string;
  total: number;
}
