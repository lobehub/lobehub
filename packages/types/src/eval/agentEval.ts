/**
 * Agent Evaluation Types
 * Defines test cases, run configurations, and metadata for agent evaluation
 */

import type { ImportedMessage } from '../export';

export type { RubricType as EvalMode } from './rubric';

export interface EvalConfig {
  [key: string]: unknown;
  envPrompt?: string;
  judgePrompt?: string;
}

export interface EvalToolForwardingConfig {
  [identifier: string]: EvalToolForwardingTarget;
}

export interface EvalToolForwardingTarget {
  endpoint: string;
  timeoutMs?: number;
}

/** Per-test-case runtime configuration used only by eval trajectories. */
export interface EvalCaseEnvironment {
  /** Case-specific system context appended after the dataset eval prompt. */
  envPrompt?: string;
  toolForwarding?: EvalToolForwardingConfig;
}

/**
 * Test case content structure
 */
export interface EvalTestCaseContent {
  category?: string;
  choices?: string[];
  environment?: EvalCaseEnvironment;
  expected?: string;
  input: string;
  /** Conversation history restored into the eval topic before `input` is sent. */
  messages?: ImportedMessage[];
}

/** A model-drafted criteria for a case about to be frozen; never saved until the user confirms. */
export interface EvalCriteriaDraft {
  criteria: string;
  expected?: string;
  /** Model that wrote the draft. */
  model: string;
  provider: string;
  /** One sentence naming what the captured answer got wrong (or right). */
  summary: string;
}

/**
 * One LLM call frozen out of a recorded run, stored inline on a test case.
 *
 * It is exactly what the model saw at that step — the context-engine output
 * messages and the tool definitions visible then — plus the model that
 * originally answered, so a replay can re-issue it against any model without
 * the source trace, which is pruned on its own lifecycle.
 */
export interface EvalFrozenCall {
  /** When the call was copied out of the trace (ISO string). */
  frozenAt: string;
  /** Context-engine output messages, in provider chat format. */
  messages: unknown[];
  /** Model that produced the captured answer. */
  model?: string;
  /** Sampling parameters the original call ran with, when the trace recorded them. */
  params?: Record<string, unknown>;
  /** Provider that produced the captured answer. */
  provider?: string;
  /** Snapshot step index of the frozen `call_llm`. */
  stepIndex: number;
  /** Tool (function) definitions visible to the model at this step. */
  tools?: unknown[];
}

/**
 * Test case metadata
 */
export interface EvalTestCaseMetadata {
  [key: string]: unknown;
  caseId?: string;
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
   * creation; never inferred from status. 'replay' re-issues each case's
   * frozen LLM call against `replayTargets` instead of re-running the agent.
   */
  executionMode?: 'external' | 'internal' | 'replay';
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
  /** Request overrides applied to every replayed call (replay runs only). */
  replayOptions?: EvalReplayOptions;
  /** Models every frozen call is re-issued against (replay runs only). */
  replayTargets?: EvalReplayTarget[];
  /**
   * Model the target agent runs on for this run, overriding the agent's own
   * setting — so comparing models is several runs of one agent, not a clone of
   * the agent per model. Set together with `subjectProvider`; unset runs the
   * agent's configured model.
   */
  subjectModel?: string;
  subjectProvider?: string;
  timeout?: number;
}

/**
 * User-facing config params for creating / updating an eval run.
 * Subset of EvalRunConfig — fields like agentSnapshot, judgeModel etc. are server-internal.
 */
export type EvalRunInputConfig = Pick<
  EvalRunConfig,
  | 'caseSelection'
  | 'k'
  | 'maxConcurrency'
  | 'maxSteps'
  | 'subjectModel'
  | 'subjectProvider'
  | 'timeout'
>;

/** One model a replay run re-issues the frozen calls against. */
export interface EvalReplayTarget {
  model: string;
  provider: string;
}

export interface EvalReplayOptions {
  maxTokens?: number;
  temperature?: number;
  /** Send the recorded tool definitions with the replayed call. @default true */
  withTools?: boolean;
}

export type EvalReplayResultStatus = 'completed' | 'error' | 'pending' | 'running';

export interface EvalReplayToolCall {
  arguments?: string;
  name: string;
}

export interface EvalReplayUsage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export interface EvalReplayError {
  message: string;
  /** Which half of the cell failed: the replayed model call or the judge. */
  stage: 'judge' | 'replay';
}

/** Per-target roll-up written to `EvalRunMetrics.byTarget` when a replay run finishes. */
export interface EvalReplayTargetMetrics {
  averageScore: number;
  errorCases: number;
  model: string;
  passedCases: number;
  passRate: number;
  provider: string;
  totalCases: number;
}

/**
 * Evaluation run metrics/statistics
 */
export interface EvalRunMetrics {
  [key: string]: unknown;
  averageScore: number;
  /** Replay runs only: one roll-up per `provider/model` target. */
  byTarget?: EvalReplayTargetMetrics[];
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
