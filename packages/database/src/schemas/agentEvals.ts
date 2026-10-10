import type {
  EvalBenchmarkRubric,
  EvalConfig,
  EvalFrozenCall,
  EvalReplayError,
  EvalReplayResultStatus,
  EvalReplayToolCall,
  EvalReplayUsage,
  EvalRunConfig,
  EvalRunMetrics,
  EvalRunTopicResult,
  EvalTestCaseContent,
  EvalTestCaseMetadata,
} from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { messages } from './message';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

const evalModes = [
  'equals',
  'contains',
  'regex',
  'starts-with',
  'ends-with',
  'any-of',
  'numeric',
  'extract-match',
  'json-schema',
  'javascript',
  'python',
  'llm-rubric',
  'factuality',
  'answer-relevance',
  'similar',
  'levenshtein',
  'rubric',
  'external',
] as const;

// ============================================
// 1. agent_eval_benchmarks (Evaluation Benchmarks)
// ============================================
export const agentEvalBenchmarks = pgTable(
  'agent_eval_benchmarks',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalBenchmarks'))
      .primaryKey(),

    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    rubrics: jsonb('rubrics').$type<EvalBenchmarkRubric[]>().notNull(),

    referenceUrl: text('reference_url'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    isSystem: boolean('is_system').default(true).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_eval_benchmarks_identifier_user_id_unique')
      .on(t.identifier, t.userId)
      .where(isNull(t.workspaceId)),
    index('agent_eval_benchmarks_is_system_idx').on(t.isSystem),
    index('agent_eval_benchmarks_user_id_idx').on(t.userId),
    index('agent_eval_benchmarks_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('agent_eval_benchmarks_identifier_workspace_id_unique')
      .on(t.workspaceId, t.identifier)
      .where(isNotNull(t.workspaceId)),
  ],
);

export type NewAgentEvalBenchmark = typeof agentEvalBenchmarks.$inferInsert;
export type AgentEvalBenchmarkItem = typeof agentEvalBenchmarks.$inferSelect;

// agent_eval_experiments
export const agentEvalExperiments = pgTable(
  'agent_eval_experiments',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalExperiments'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    index('agent_eval_experiments_user_id_idx').on(t.userId),
    index('agent_eval_experiments_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentEvalExperiment = typeof agentEvalExperiments.$inferInsert;
export type AgentEvalExperimentItem = typeof agentEvalExperiments.$inferSelect;

// agent_eval_experiment_benchmarks
export const agentEvalExperimentBenchmarks = pgTable(
  'agent_eval_experiment_benchmarks',
  {
    experimentId: text('experiment_id')
      .references(() => agentEvalExperiments.id, { onDelete: 'cascade' })
      .notNull(),

    benchmarkId: text('benchmark_id')
      .references(() => agentEvalBenchmarks.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.experimentId, t.benchmarkId] }),
    index('agent_eval_experiment_benchmarks_benchmark_id_idx').on(t.benchmarkId),
    index('agent_eval_experiment_benchmarks_user_id_idx').on(t.userId),
    index('agent_eval_experiment_benchmarks_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentEvalExperimentBenchmark = typeof agentEvalExperimentBenchmarks.$inferInsert;
export type AgentEvalExperimentBenchmarkItem = typeof agentEvalExperimentBenchmarks.$inferSelect;

// ============================================
// 2. agent_eval_datasets (Evaluation Datasets)
// ============================================
export const agentEvalDatasets = pgTable(
  'agent_eval_datasets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalDatasets'))
      .primaryKey(),

    /**
     * The published benchmark this dataset is a part of, when it is part of one.
     * Nullable because a benchmark models a *published* suite — it carries
     * `rubrics`, a `referenceUrl` and `isSystem` — while a dataset accumulated
     * from captured cases has no such origin and each of its cases carries its
     * own criteria. Requiring one forced those datasets to invent a fake
     * benchmark row, which also put them under its delete cascade.
     *
     * A *run* still requires one: the benchmark is what defines the shared
     * rubrics a run is scored against.
     */
    benchmarkId: text('benchmark_id').references(() => agentEvalBenchmarks.id, {
      onDelete: 'cascade',
    }),

    sourceExperimentId: text('source_experiment_id').references(() => agentEvalExperiments.id, {
      onDelete: 'set null',
    }),

    identifier: text('identifier').notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    evalMode: text('eval_mode', { enum: evalModes }),
    evalConfig: jsonb('eval_config').$type<EvalConfig>(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_eval_datasets_identifier_user_id_unique')
      .on(t.identifier, t.userId)
      .where(isNull(t.workspaceId)),
    index('agent_eval_datasets_benchmark_id_idx').on(t.benchmarkId),
    index('agent_eval_datasets_source_experiment_id_idx').on(t.sourceExperimentId),
    index('agent_eval_datasets_user_id_idx').on(t.userId),
    index('agent_eval_datasets_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('agent_eval_datasets_identifier_workspace_id_unique')
      .on(t.workspaceId, t.identifier)
      .where(isNotNull(t.workspaceId)),
  ],
);

export type NewAgentEvalDataset = typeof agentEvalDatasets.$inferInsert;
export type AgentEvalDatasetItem = typeof agentEvalDatasets.$inferSelect;

// ============================================
// 3. agent_eval_test_cases (Evaluation Test Cases)
// ============================================
export const agentEvalTestCases = pgTable(
  'agent_eval_test_cases',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalTestCases'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    datasetId: text('dataset_id')
      .references(() => agentEvalDatasets.id, { onDelete: 'cascade' })
      .notNull(),

    content: jsonb('content').$type<EvalTestCaseContent>().notNull(),

    evalMode: text('eval_mode', { enum: evalModes }),
    evalConfig: jsonb('eval_config').$type<EvalConfig>(),

    metadata: jsonb('metadata').$type<EvalTestCaseMetadata>(),

    sortOrder: integer('sort_order'),

    // Provenance of a case frozen out of a real conversation. The topic,
    // message and trace can all be deleted later; the frozen call stored inline
    // below keeps the case replayable after they are gone.
    sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    sourceMessageId: text('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    // No FK: operation rows are pruned independently of the cases built on them.
    sourceOperationId: text('source_operation_id'),
    /** Snapshot step index of the frozen `call_llm` (`FrozenCall.stepIndex`). */
    frozenStepIndex: integer('frozen_step_index'),
    /**
     * The LLM call replay runs re-issue: the context-engine messages, the tools
     * visible at that step and the original model/provider. Stored on the row
     * rather than referenced in S3 so it outlives the trace it was copied from.
     */
    frozenCall: jsonb('frozen_call').$type<EvalFrozenCall>(),

    ...timestamps,
  },
  (t) => [
    index('agent_eval_test_cases_user_id_idx').on(t.userId),
    index('agent_eval_test_cases_dataset_id_idx').on(t.datasetId),
    index('agent_eval_test_cases_sort_order_idx').on(t.sortOrder),
    index('agent_eval_test_cases_workspace_id_idx').on(t.workspaceId),
    index('agent_eval_test_cases_source_message_id_idx').on(t.sourceMessageId),
  ],
);

export type NewAgentEvalTestCase = typeof agentEvalTestCases.$inferInsert;
export type AgentEvalTestCaseItem = typeof agentEvalTestCases.$inferSelect;

// ============================================
// 4. agent_eval_runs (Evaluation Runs)
// ============================================
export const agentEvalRuns = pgTable(
  'agent_eval_runs',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalRuns'))
      .primaryKey(),

    datasetId: text('dataset_id')
      .references(() => agentEvalDatasets.id, { onDelete: 'cascade' })
      .notNull(),

    experimentId: text('experiment_id').references(() => agentEvalExperiments.id),

    parentRunId: text('parent_run_id'),

    targetAgentId: text('target_agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    name: text('name'),

    status: text('status', {
      enum: ['idle', 'pending', 'running', 'completed', 'failed', 'aborted', 'external'],
    })
      .default('idle')
      .notNull(),

    config: jsonb('config').$type<EvalRunConfig>(),

    metrics: jsonb('metrics').$type<EvalRunMetrics>(),

    startedAt: timestamptz('started_at'),

    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.parentRunId],
      foreignColumns: [t.id],
      name: 'agent_eval_runs_parent_run_id_agent_eval_runs_id_fk',
    }),
    index('agent_eval_runs_dataset_id_idx').on(t.datasetId),
    index('agent_eval_runs_experiment_id_idx').on(t.experimentId),
    index('agent_eval_runs_parent_run_id_idx').on(t.parentRunId),
    index('agent_eval_runs_user_id_idx').on(t.userId),
    index('agent_eval_runs_status_idx').on(t.status),
    index('agent_eval_runs_target_agent_id_idx').on(t.targetAgentId),
    index('agent_eval_runs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentEvalRun = typeof agentEvalRuns.$inferInsert;
export type AgentEvalRunItem = typeof agentEvalRuns.$inferSelect;

// ============================================
// 5. agent_eval_run_topics (Evaluation Run and Topic Association Table)
// ============================================
export const agentEvalRunTopics = pgTable(
  'agent_eval_run_topics',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    runId: text('run_id')
      .references(() => agentEvalRuns.id, { onDelete: 'cascade' })
      .notNull(),

    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),

    testCaseId: text('test_case_id')
      .references(() => agentEvalTestCases.id, { onDelete: 'cascade' })
      .notNull(),

    status: text('status', {
      enum: ['pending', 'running', 'passed', 'failed', 'error', 'timeout', 'external', 'completed'],
    }),

    score: real('score'),
    passed: boolean('passed'),
    evalResult: jsonb('eval_result').$type<EvalRunTopicResult>(),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.topicId] }),
    index('agent_eval_run_topics_user_id_idx').on(t.userId),
    index('agent_eval_run_topics_run_id_idx').on(t.runId),
    index('agent_eval_run_topics_test_case_id_idx').on(t.testCaseId),
    index('agent_eval_run_topics_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentEvalRunTopic = typeof agentEvalRunTopics.$inferInsert;
export type AgentEvalRunTopicItem = typeof agentEvalRunTopics.$inferSelect;

// ============================================
// 6. agent_eval_replay_results (Frozen-call replay results)
// ============================================
/**
 * One cell of a cross-model comparison: a test case's frozen LLM call
 * re-issued against one `provider/model`, plus its judge verdict. Unlike
 * `agent_eval_run_topics`, a cell owns no topic — a replay is a single call,
 * not a conversation.
 */
export const agentEvalReplayResults = pgTable(
  'agent_eval_replay_results',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalReplayResults'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    runId: text('run_id')
      .references(() => agentEvalRuns.id, { onDelete: 'cascade' })
      .notNull(),
    testCaseId: text('test_case_id')
      .references(() => agentEvalTestCases.id, { onDelete: 'cascade' })
      .notNull(),

    provider: text('provider').notNull(),
    model: text('model').notNull(),

    status: text('status').$type<EvalReplayResultStatus>().default('pending').notNull(),

    content: text('content'),
    toolCalls: jsonb('tool_calls').$type<EvalReplayToolCall[]>(),
    usage: jsonb('usage').$type<EvalReplayUsage>(),
    durationMs: integer('duration_ms'),

    score: real('score'),
    passed: boolean('passed'),
    judgeReason: text('judge_reason'),

    error: jsonb('error').$type<EvalReplayError>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_eval_replay_results_cell_unique').on(
      t.runId,
      t.testCaseId,
      t.provider,
      t.model,
    ),
    index('agent_eval_replay_results_run_id_idx').on(t.runId),
    index('agent_eval_replay_results_test_case_id_idx').on(t.testCaseId),
    index('agent_eval_replay_results_user_id_idx').on(t.userId),
    index('agent_eval_replay_results_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAgentEvalReplayResult = typeof agentEvalReplayResults.$inferInsert;
export type AgentEvalReplayResultItem = typeof agentEvalReplayResults.$inferSelect;
