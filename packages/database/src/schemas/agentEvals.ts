import type {
  EvalBenchmarkRubric,
  EvalConfig,
  EvalRunConfig,
  EvalRunMetrics,
  EvalRunTopicResult,
  EvalTestCaseContent,
  EvalTestCaseMetadata,
} from '@lobechat/types';
import {
  boolean,
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
] as const;

// ============================================
// 1. agent_eval_benchmarks（评测基准）
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

    isSystem: boolean('is_system').default(true).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_eval_benchmarks_identifier_user_id_unique').on(t.identifier, t.userId),
    index('agent_eval_benchmarks_is_system_idx').on(t.isSystem),
    index('agent_eval_benchmarks_user_id_idx').on(t.userId),
  ],
);

export type NewAgentEvalBenchmark = typeof agentEvalBenchmarks.$inferInsert;
export type AgentEvalBenchmarkItem = typeof agentEvalBenchmarks.$inferSelect;

// ============================================
// 2. agent_eval_datasets（评测题集）
// ============================================
export const agentEvalDatasets = pgTable(
  'agent_eval_datasets',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('evalDatasets'))
      .primaryKey(),

    benchmarkId: text('benchmark_id')
      .references(() => agentEvalBenchmarks.id, { onDelete: 'cascade' })
      .notNull(),

    identifier: text('identifier').notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    evalMode: text('eval_mode', { enum: evalModes }),
    evalConfig: jsonb('eval_config').$type<EvalConfig>(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('agent_eval_datasets_identifier_user_id_unique').on(t.identifier, t.userId),
    index('agent_eval_datasets_benchmark_id_idx').on(t.benchmarkId),
    index('agent_eval_datasets_user_id_idx').on(t.userId),
  ],
);

export type NewAgentEvalDataset = typeof agentEvalDatasets.$inferInsert;
export type AgentEvalDatasetItem = typeof agentEvalDatasets.$inferSelect;

// ============================================
// 3. agent_eval_test_cases（评测题目）
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

    datasetId: text('dataset_id')
      .references(() => agentEvalDatasets.id, { onDelete: 'cascade' })
      .notNull(),

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
    index('agent_eval_test_cases_sort_order_idx').on(t.sortOrder),
  ],
);

export type NewAgentEvalTestCase = typeof agentEvalTestCases.$inferInsert;
export type AgentEvalTestCaseItem = typeof agentEvalTestCases.$inferSelect;

// ============================================
// 4. agent_eval_runs（评测运行）
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

    targetAgentId: text('target_agent_id').references(() => agents.id, { onDelete: 'cascade' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    name: text('name'),

    status: text('status', {
      enum: ['idle', 'pending', 'running', 'completed', 'failed', 'aborted'],
    })
      .default('idle')
      .notNull(),

    config: jsonb('config').$type<EvalRunConfig>(),

    metrics: jsonb('metrics').$type<EvalRunMetrics>(),

    startedAt: timestamptz('started_at'),

    ...timestamps,
  },
  (t) => [
    index('agent_eval_runs_dataset_id_idx').on(t.datasetId),
    index('agent_eval_runs_user_id_idx').on(t.userId),
    index('agent_eval_runs_status_idx').on(t.status),
    index('agent_eval_runs_target_agent_id_idx').on(t.targetAgentId),
  ],
);

export type NewAgentEvalRun = typeof agentEvalRuns.$inferInsert;
export type AgentEvalRunItem = typeof agentEvalRuns.$inferSelect;

// ============================================
// 5. agent_eval_run_topics（评测运行与 Topic 关联表）
// ============================================
export const agentEvalRunTopics = pgTable(
  'agent_eval_run_topics',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

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
      enum: ['pending', 'running', 'passed', 'failed', 'error', 'timeout'],
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
  ],
);

export type NewAgentEvalRunTopic = typeof agentEvalRunTopics.$inferInsert;
export type AgentEvalRunTopicItem = typeof agentEvalRunTopics.$inferSelect;
