/**
 * Agent Evaluation Types
 * Defines test cases, run configurations, and metadata for agent evaluation
 */

export type { RubricType as EvalMode } from './rubric';

export interface EvalConfig {
  [key: string]: unknown;
  envPrompt?: string;
  judgePrompt?: string;
}

/**
 * Test case content structure
 */
export interface EvalTestCaseContent {
  category?: string;
  choices?: string[];
  expected?: string;
  input: string;
}

/**
 * Test case metadata
 */
export interface EvalTestCaseMetadata {
  [key: string]: unknown;
  difficulty?: 'easy' | 'hard' | 'medium';
  source?: string;
  tags?: string[];
}

/**
 * Evaluation run status
 */
export type EvalRunStatus = 'aborted' | 'completed' | 'external' | 'failed' | 'pending' | 'running';

/**
 * Evaluation run configuration
 */
export interface EvalRunAgentSnapshot {
  avatar?: string | null;
  chatConfig?: Record<string, unknown> | null;
  description?: string | null;
  fewShots?: unknown[] | null;
  model?: string | null;
  params?: Record<string, unknown> | null;
  plugins?: string[] | null;
  provider?: string | null;
  systemRole?: string | null;
  title?: string | null;
}

/**
 * Case selection for scoping a run to a subset of dataset cases.
 * Stored verbatim in the run config for Exp Proposal ↔ Run Config consistency
 * checks; dispatch filtering is owned by the external worker.
 */
export interface EvalCaseSelection {
  /**
   * Dataset-native `metadata.caseId` values (NOT internal TestCase primary
   * keys). Required (non-empty, unique, non-blank) for include/exclude;
   * must be absent for 'all'.
   */
  caseIds?: string[];
  /**
   * all (default): every case; include: only caseIds; exclude: all except caseIds
   */
  mode: 'all' | 'exclude' | 'include';
}

export interface EvalRunConfig {
  [key: string]: unknown;
  agentSnapshot?: EvalRunAgentSnapshot;
  caseSelection?: EvalCaseSelection;
  /**
   * Immutable snapshot of how the run executes: 'internal' (QStash workflow,
   * topics pre-created) or 'external' (worker-driven, on-demand). Written at
   * creation; never inferred from status.
   */
  executionMode?: 'external' | 'internal';
  judgeModel?: string;
  judgeProvider?: string;
  /**
   * Number of times to execute each test case (for pass@K, pass^K metrics)
   * @default 1
   */
  k?: number;
  maxConcurrency?: number;
  maxSteps?: number;
  /**
   * Score threshold for a test case to be considered "passed"
   * @default 0.6
   */
  passThreshold?: number;
  promptTemplate?: {
    system?: string;
    user: string;
  };
  timeout?: number;
}

/**
 * User-facing config params for creating / updating an eval run.
 * Subset of EvalRunConfig — fields like agentSnapshot, judgeModel etc. are server-internal.
 */
export type EvalRunInputConfig = Pick<
  EvalRunConfig,
  'caseSelection' | 'k' | 'maxConcurrency' | 'maxSteps' | 'timeout'
>;

/**
 * Evaluation run metrics/statistics
 */
export interface EvalRunMetrics {
  [key: string]: unknown;
  averageScore: number;
  completedCases?: number;
  /** Sum of per-case average costs (for per-case display: cost / totalCases) */
  cost?: number;
  duration?: number;
  errorCases?: number;
  externalCases?: number;
  failedCases: number;
  llmCalls?: number;
  passAllK?: number;
  passAtK?: number;
  passedCases: number;
  passRate: number;
  perCaseCost?: number;
  perCaseLlmCalls?: number;
  perCaseSteps?: number;
  perCaseTokens?: number;
  perCaseToolCalls?: number;
  rubricScores?: Record<string, number>;
  steps?: number;
  timeoutCases?: number;
  /** Sum of per-case average tokens */
  tokens?: number;
  toolCalls?: number;
  totalCases: number;
  /** Actual total cost across all K executions */
  totalCost?: number;
  /** Actual cumulative duration across all K executions */
  totalDuration?: number;
  /** Actual total tokens across all K executions */
  totalTokens?: number;
}

/**
 * Field mapping configuration for dataset import
 */
export interface ImportFieldMapping {
  category?: string;
  choices?: string;
  expected?: string;
  expectedDelimiter?: string;
  input: string;
  metadata?: Record<string, string>;
  sortOrder?: string;
}

/**
 * Evaluation topic metadata extension
 */
export interface EvalTopicMetadata {
  benchmarkId: string;
  datasetId: string;
  evalRunId: string;
  testCaseId: string;
}

/**
 * Individual rubric score result
 */
export interface EvalRubricScore {
  reason?: string;
  rubricId: string;
  score: number;
}

/*eslint-disable perfectionist/sort-interfaces */
/**
 * Evaluation result stored on RunTopic after scoring
 */
export interface EvalRunTopicResult {
  cost?: number;
  tokens?: number;
  duration?: number;
  steps?: number;
  llmCalls?: number;
  toolCalls?: number;

  /** K-thread cumulative totals (only present when K > 1) */
  totalCost?: number;
  totalTokens?: number;
  totalDuration?: number;

  threads?: EvalThreadResult[];
  /** pass^k: all K threads passed */
  passAllK?: boolean;
  /** pass@k: at least one of K threads passed */
  passAtK?: boolean;

  error?: string;
  errorDetail?: unknown;
  /** Opaque evidence reported by an external evaluator. */
  externalResult?: Record<string, unknown>;
  /** Per-thread external evidence for K > 1 runs. */
  externalThreadResults?: Record<string, unknown>;
  extractedAnswer?: string;
  completionReason?: string;
  operationId?: string;
  rubricScores?: EvalRubricScore[];
  /** Set when evalMode is 'external' — agent finished, awaiting external scoring */
  awaitingExternalEval?: boolean;
}
/*eslint-enable perfectionist/sort-interfaces */

/**
 * Per-thread evaluation result (for pass@k / pass^k)
 */
export interface EvalThreadResult {
  completionReason?: string;
  cost?: number;
  duration?: number;
  error?: string;
  llmCalls?: number;
  operationId?: string;
  passed?: boolean;
  rubricScores?: EvalRubricScore[];
  score?: number;
  status?: 'error' | 'external' | 'failed' | 'passed' | 'running' | 'timeout' | 'completed';
  steps?: number;
  threadId: string;
  tokens?: number;
  toolCalls?: number;
}

/**
 * Evaluation thread metadata extension (stored on thread.metadata)
 */
export interface EvalThreadMetadata {
  completedAt?: string;
  cost?: number;
  duration?: number;
  error?: string;
  passed?: boolean;
  rubricScores?: EvalRubricScore[];
  score?: number;
  testCaseId: string;
}
