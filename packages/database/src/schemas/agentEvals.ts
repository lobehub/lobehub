import type {
  EvalBenchmarkRubric,
  EvalCaseEnvironment,
  EvalConfig,
  EvalRunConfig,
  EvalRunMetrics,
  EvalRunTopicResult,
  EvalTestCaseContent,
  EvalTestCaseMetadata,
} from '@lobechat/types';
import { isNotNull, isNull, sql } from 'drizzle-orm';
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
  'rule-checklist',
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
// 2b. agent_eval_environments (Reusable Case Environments)
// ============================================
/**
 * The environment many cases share: the Agent setup (persona, tools, memory
 * switch), the Memory fixture, the clock and the mock connectors. A case
 * points at one through `environment_id`, so one environment can back five,
 * ten or a hundred cases instead of each case carrying its own copy.
 */
export const agentEvalEnvironments = pgTable(
  'agent_eval_environments',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalEnvironments'))
      .primaryKey(),

    // Nullable: a system row (the built-in case sets) belongs to no user.
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Stable handle for scripts and imports; unique per owner when set. */
    identifier: text('identifier'),
    name: text('name').notNull(),
    description: text('description'),

    config: jsonb('config').$type<EvalCaseEnvironment>().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    index('agent_eval_environments_user_id_idx').on(t.userId),
    index('agent_eval_environments_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('agent_eval_environments_identifier_user_id_unique')
      .on(t.identifier, t.userId)
      .where(sql`${t.identifier} IS NOT NULL AND ${t.workspaceId} IS NULL`),
    uniqueIndex('agent_eval_environments_identifier_workspace_id_unique')
      .on(t.identifier, t.workspaceId)
      .where(sql`${t.identifier} IS NOT NULL AND ${t.workspaceId} IS NOT NULL`),
  ],
);

export type NewAgentEvalEnvironment = typeof agentEvalEnvironments.$inferInsert;
export type AgentEvalEnvironmentItem = typeof agentEvalEnvironments.$inferSelect;

// ============================================
// 3. agent_eval_test_cases (Evaluation Test Cases)
// ============================================
export const agentEvalTestCases = pgTable(
  'agent_eval_test_cases',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalTestCases'))
      .primaryKey(),

    // Nullable: a system row (the built-in case sets) belongs to no user.
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    datasetId: text('dataset_id')
      .references(() => agentEvalDatasets.id, { onDelete: 'cascade' })
      .notNull(),

    /**
     * The shared environment this case runs in; `content.environment` holds
     * only what this case changes on top of it (or everything, for a case
     * without one).
     */
    environmentId: text('environment_id').references(() => agentEvalEnvironments.id, {
      onDelete: 'set null',
    }),

    content: jsonb('content').$type<EvalTestCaseContent>().notNull(),

    evalMode: text('eval_mode', { enum: evalModes }),
    evalConfig: jsonb('eval_config').$type<EvalConfig>(),

    metadata: jsonb('metadata').$type<EvalTestCaseMetadata>(),

    sortOrder: integer('sort_order'),

    ...timestamps,
  },
  (t) => [
    index('agent_eval_test_cases_user_id_idx').on(t.userId),
    index('agent_eval_test_cases_dataset_id_idx').on(t.datasetId),
    index('agent_eval_test_cases_environment_id_idx').on(t.environmentId),
    index('agent_eval_test_cases_sort_order_idx').on(t.sortOrder),
    index('agent_eval_test_cases_workspace_id_idx').on(t.workspaceId),
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
      // `judge_error`: the attempt ran, but grading it failed (judge model,
      // config or parse error). Its answer, memory and cost are kept; it is
      // re-judged, never re-executed, and counted apart from `failed`.
      enum: [
        'pending',
        'running',
        'passed',
        'failed',
        'error',
        'timeout',
        'external',
        'completed',
        'judge_error',
      ],
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
