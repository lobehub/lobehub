/**
 * Agent Evaluation Types
 * Defines test cases, run configurations, and metadata for agent evaluation
 */

import type { AgentMemoryChatConfig, LobeAgentChatConfig } from '../agent/chatConfig';
import type { ImportedMessage } from '../export';
import type { EvalMemoryFixture, EvalMemorySnapshot } from './evalMemory';
import type { EvalToolManifest, EvalToolManifests } from './toolManifest';

export type { RubricType as EvalMode } from './rubric';

export interface EvalConfig {
  [key: string]: unknown;
  envPrompt?: string;
  judgePrompt?: string;
}

export interface EvalToolForwardingConfig {
  [identifier: string]: EvalToolForwardingTarget;
}

/** A local connection selected for one logical mock service; never contains credentials. */
export interface EvalConnectorBinding {
  connectorId: string;
  transport?: 'mcp' | 'lobe-bench';
}

export type EvalConnectorBindings = Record<string, EvalConnectorBinding>;

/**
 * A mock connection kept in its Environment instead of a user connector row.
 * Bindings name it `env:<environmentId>:<service>` (see `environmentConnectionId`).
 * `credentials` is the server-encrypted credential JSON and never leaves the
 * server: copies sent to clients drop it and carry `hasCredentials` instead.
 */
export interface EvalEnvironmentConnection {
  credentials?: string | null;
  /** Set only on redacted copies sent to clients. */
  hasCredentials?: boolean;
  name?: string;
  url: string;
}

/** Server-captured connection identity and tool contract used by a run. */
export interface EvalConnectorSnapshot extends EvalConnectorBinding {
  /** Frozen owning Dataset; absent only on legacy runs, which cannot resume. */
  datasetId?: string;
  fingerprint: string;
  /** Frozen original contract; absent on legacy runs, which must not resume with a new surface. */
  manifest?: EvalToolManifest;
}

export type EvalConnectorSnapshots = Record<string, EvalConnectorSnapshot>;

/** Sampling parameters a model-only run applies to every case's hidden Agent. */
export interface EvalRunModelParams {
  frequency_penalty?: number;
  presence_penalty?: number;
  temperature?: number;
  top_p?: number;
}

/**
 * Model-specific settings (reasoning on/off and effort, thinking level and
 * budget, verbosity …) a model-only run applies to every case's hidden Agent:
 * the ones the chat model-params panel offers, per the model's
 * `settings.extendParams`. Together with `EvalRunModelParams` they make one
 * "contender": the same model with another setting is a different contender.
 */
export type EvalRunChatConfig = Pick<
  LobeAgentChatConfig,
  | 'codexMaxReasoningEffort'
  | 'deepseekV4GAReasoningEffort'
  | 'deepseekV4ReasoningEffort'
  | 'disableContextCaching'
  | 'effort'
  | 'enableAdaptiveThinking'
  | 'enableReasoning'
  | 'glm5_2ReasoningEffort'
  | 'glm5_3ReasoningEffort'
  | 'gpt5_1ReasoningEffort'
  | 'gpt5_2ProReasoningEffort'
  | 'gpt5_2ReasoningEffort'
  | 'gpt5_6ReasoningEffort'
  | 'gpt5ReasoningEffort'
  | 'gpt6ReasoningEffort'
  | 'grok4_20ReasoningEffort'
  | 'grok4_3ReasoningEffort'
  | 'grok4_5ReasoningEffort'
  | 'grok4_6ReasoningEffort'
  | 'grok4_7ReasoningEffort'
  | 'hy3ReasoningEffort'
  | 'kimiK3ReasoningEffort'
  | 'opus47Effort'
  | 'preserveThinking'
  | 'qwen38ReasoningEffort'
  | 'reasoningBudgetToken'
  | 'reasoningBudgetToken32k'
  | 'reasoningBudgetToken80k'
  | 'reasoningEffort'
  | 'reasoningMode'
  | 'ring2_6ReasoningEffort'
  | 'step3_5ReasoningEffort'
  | 'textVerbosity'
  | 'thinking'
  | 'thinkingBudget'
  | 'thinkingLevel'
  | 'thinkingLevel2'
  | 'thinkingLevel3'
  | 'thinkingLevel4'
>;

/** Logical mock services required by a case, independent of deployment and credentials. */
export interface EvalCaseMockConfig {
  /** Tool namespaces, each resolved through the environment's connector bindings. */
  services: string[];
}

export interface EvalToolForwardingTarget {
  /**
   * Historical endpoint retained only for reading old data. New writes reject
   * it, and execution resolves the selected connection's address instead.
   */
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * The Agent a test case brings with it. A case that carries one runs on its
 * own hidden (`virtual`) Agent built from this setup, so a benchmark can give
 * every case a different persona and tool set without touching the user's
 * Agent list. Omitted fields fall back to the run's target Agent, or to the
 * product defaults when the run only picks a model.
 */
export interface EvalCaseAgentConfig {
  memory?: AgentMemoryChatConfig['memory'];
  /** The name the model is told the user knows it by; no identity line when absent. */
  name?: string;
  /** Exact tool allowlist (plugin identifiers); an empty array disables tools. */
  plugins?: string[];
  systemRole?: string;
  title?: string;
}

/** Per-test-case runtime configuration used only by eval trajectories. */
export interface EvalCaseEnvironment {
  agent?: EvalCaseAgentConfig;
  /**
   * Mock connections stored in this Environment row, by service. Only a shared
   * Environment carries them; a case's own overrides never do.
   */
  connections?: Record<string, EvalEnvironmentConnection>;
  /** Logical tool identifiers bound to scoped MCP connections in this installation. */
  connectorBindings?: EvalConnectorBindings;
  /** Case-specific system context appended after the dataset eval prompt. */
  envPrompt?: string;
  /**
   * Memory each attempt starts from. Every attempt (and every pass@k thread)
   * runs on its own isolated Memory owner seeded with this fixture; `{}` starts
   * empty. The caller's own memories are never read or written by a trial.
   */
  memory?: EvalMemoryFixture;
  /**
   * Logical mock services required by this case. Each service must be bound
   * to an available connection before execution.
   */
  mock?: EvalCaseMockConfig;
  /**
   * The attempt's clock, an ISO date or instant. Every "today" the model sees
   * (the `{{date}}` placeholder, the system date line, a tool prompt's current
   * date) renders from it instead of the wall clock, so the case reads the same
   * on any day it is run. Nothing tells the model the date is pinned.
   */
  sessionDate?: string;
  /** IANA timezone `sessionDate` renders in; UTC when absent. */
  timezone?: string;
  toolForwarding?: EvalToolForwardingConfig;
  /** Original model-visible contracts, independent of mock connection discovery. */
  toolManifests?: EvalToolManifests;
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
   * The version of the dataset's cases the run ran on ({@link evalCaseVersionOf}),
   * captured by the server when the run is created. Cases are edited in place,
   * so a leaderboard counts only runs on the dataset's current version.
   */
  caseVersion?: string;
  /** Model-specific settings of a model-only run; see {@link EvalRunChatConfig}. */
  chatConfig?: EvalRunChatConfig;
  /** Server-owned connection snapshots, keyed by case database ID. Credentials are excluded. */
  connectorSnapshots?: Record<string, EvalConnectorSnapshots>;
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
  /**
   * How many cases of the run execute at once (each with its k attempts). Unset,
   * every case starts together; set, the rest wait and start as cases finish.
   */
  maxConcurrency?: number;
  maxSteps?: number;
  /**
   * Model every case runs on. Set it to compare models on a benchmark: the
   * run then needs no target Agent, and each case runs on a hidden Agent
   * built from its own setup plus this model.
   */
  model?: string;
  /** Sampling parameters of a model-only run; see {@link EvalRunModelParams}. */
  params?: EvalRunModelParams;
  /**
   * Score threshold for a test case to be considered "passed"
   * @default 0.6
   */
  passThreshold?: number;
  promptTemplate?: {
    system?: string;
    user: string;
  };
  /** Provider of `model`; always set together with it. */
  provider?: string;
  timeout?: number;
}

/**
 * User-facing config params for creating / updating an eval run.
 * Subset of EvalRunConfig — fields like agentSnapshot, judgeModel etc. are server-internal.
 */
export type EvalRunInputConfig = Pick<
  EvalRunConfig,
  | 'caseSelection'
  | 'chatConfig'
  | 'k'
  | 'maxConcurrency'
  | 'maxSteps'
  | 'model'
  | 'params'
  | 'provider'
  | 'timeout'
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
  /**
   * Attempts that ran but could not be graded (judge failure). Not in
   * `failedCases`, not in `averageScore`: the run's grading is incomplete
   * until they are re-judged.
   */
  judgeErrorCases?: number;
  llmCalls?: number;
  /**
   * Share of cases expected to pass all j attempts (pass^j), for every j up to
   * the run's attempts, keyed by j. Estimated without bias from each case's c
   * passed of n attempts as C(c,j)/C(n,j), so a run of 5 attempts also says how
   * it would fare on 3.
   */
  passAllAt?: Record<string, number>;
  passAllK?: number;
  /** Share of cases expected to pass at least one of j attempts (pass@j): 1 − C(n−c,j)/C(n,j). */
  passAnyAt?: Record<string, number>;
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
/** One rule of a `rule-checklist` rubric, as the judge decided it. */
export interface EvalRuleVerdict {
  reason?: string;
  /** The rule as shown to the judge, e.g. "Must: Submit exactly one order". */
  rule: string;
  verdict: 'satisfied' | 'unverifiable' | 'violated';
}

export interface EvalRubricScore {
  reason?: string;
  rubricId: string;
  score: number;
  /** Per-rule verdicts of a `rule-checklist` rubric. */
  verdicts?: EvalRuleVerdict[];
}

/*eslint-disable perfectionist/sort-interfaces */
/**
 * Evaluation result stored on RunTopic after scoring
 */
export interface EvalRunTopicResult {
  /** When a run with a concurrency limit handed this waiting case a slot. */
  dispatchedAt?: string;
  /** Identity of the current execution, used to fence delayed callbacks. */
  executionId?: string;
  /** Actual requested model/provider pairs used for this grading attempt. */
  judges?: Array<{ model: string; provider: string }>;
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
  /** Which stage failed when `status` is `judge_error`: the judge, never the candidate. */
  errorPhase?: 'judge';
  /** Why grading failed (judge model, config or parse error); cleared by a successful re-judge. */
  judgeError?: string;
  /** Opaque evidence reported by an external evaluator. */
  externalResult?: Record<string, unknown>;
  /** Per-thread external evidence for K > 1 runs. */
  externalThreadResults?: Record<string, unknown>;
  extractedAnswer?: string;
  completionReason?: string;
  /** Final state of the attempt's isolated Memory, kept after the owner is deleted. */
  memorySnapshot?: EvalMemorySnapshot;
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
  /** Older stored attempts may carry this without a judge_error status. */
  errorPhase?: 'judge';
  executionId?: string;
  /** Why grading this thread failed; the thread is re-judged, not re-run. */
  judgeError?: string;
  /** Actual requested model/provider pairs, preserved independently of defaults. */
  judges?: Array<{ model: string; provider: string }>;
  llmCalls?: number;
  /** Final state of this thread's isolated Memory, kept after the owner is deleted. */
  memorySnapshot?: EvalMemorySnapshot;
  operationId?: string;
  passed?: boolean;
  rubricScores?: EvalRubricScore[];
  score?: number;
  status?:
    | 'error'
    | 'external'
    | 'failed'
    | 'passed'
    | 'running'
    | 'timeout'
    | 'completed'
    | 'judge_error';
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

/**
 * The version of a dataset's cases: the Release they were published in, with the
 * presentation the bench engine serves tool results in (it changes what a model
 * sees without a new Release). Undefined for a dataset that records no Release.
 */
export const evalCaseVersionOf = (
  metadata?: Record<string, unknown> | null,
): string | undefined => {
  const release = typeof metadata?.release === 'string' ? metadata.release : undefined;
  if (!release) return undefined;
  const presentation =
    typeof metadata?.presentation === 'string' ? metadata.presentation : undefined;
  return presentation ? `${release}+${presentation}` : release;
};
