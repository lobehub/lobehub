import { z } from 'zod';

import { goalStatuses } from '@/const/goal';

// ==================== Path / Query Schemas ====================

export const GoalIdParamSchema = z.object({
  id: z.string().min(1),
});
export type GoalIdParam = z.infer<typeof GoalIdParamSchema>;

/**
 * Query strings cannot carry repeated/typed values the way the tRPC surface can,
 * so list filters arrive as strings: numbers are coerced and `statuses` is a
 * comma-separated list (`?statuses=running,paused`).
 */
export const GoalListQuerySchema = z.object({
  agentId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  projectId: z.string().optional(),
  statuses: z
    .string()
    .optional()
    .transform((value) =>
      value
        ?.split(',')
        .map((status) => status.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(goalStatuses)).optional()),
  topicId: z.string().optional(),
});
export type GoalListQuery = z.infer<typeof GoalListQuerySchema>;

// ==================== Request Body Schemas ====================

export const GoalCriterionSchema = z.object({
  description: z.string().optional(),
  instruction: z.string().optional(),
  title: z.string().min(1),
});

export const GoalTaskSeedSchema = z.union([
  z.string().min(1),
  z.object({
    description: z.string().optional(),
    title: z.string().min(1),
  }),
]);

export const CreateGoalRequestSchema = z.object({
  /** The agent that supervises the goal; defaults to the authoring agent. */
  agentId: z.string().optional(),
  /** Coordinator config (budget, concurrency, task agent, acceptance metrics…). */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Structured acceptance criteria, persisted as verify criteria rows. */
  criteria: z.array(GoalCriterionSchema).optional(),
  /** Calendar deadline for the whole goal, ISO-8601. */
  deadline: z.string().datetime().optional(),
  /** Cap on total spend in USD. */
  maxTotalCost: z.number().positive().optional(),
  problemDescription: z.string().optional(),
  projectId: z.string().optional(),
  requirement: z.string().optional(),
  /** Seed task nodes. Omit to let the coordinator plan the decomposition. */
  tasks: z.array(GoalTaskSeedSchema).optional(),
  title: z.string().min(1),
});
export type CreateGoalRequest = z.infer<typeof CreateGoalRequestSchema>;

/**
 * Budget knobs mirror the `lh goal set-budget` surface: `null` clears a bound,
 * omitting it leaves the current value in place.
 */
export const UpdateGoalBudgetSchema = z.object({
  deadline: z.string().datetime().nullable().optional(),
  maxAttemptsPerTask: z.number().int().positive().optional(),
  maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
  maxExperiments: z.number().int().min(1).max(200).optional(),
  maxManagerTurns: z.number().int().min(1).max(100).optional(),
  maxRounds: z.number().int().positive().nullable().optional(),
  maxStepsPerRun: z.number().int().positive().nullable().optional(),
  maxTotalCost: z.number().positive().nullable().optional(),
});
export type UpdateGoalBudget = z.infer<typeof UpdateGoalBudgetSchema>;

export const UpdateGoalRequestSchema = z
  .object({
    budget: UpdateGoalBudgetSchema.optional(),
    /** Rewrites the "what counts as done" text every task's context reads. */
    requirement: z.string().min(1).optional(),
  })
  .refine((value) => value.budget !== undefined || value.requirement !== undefined, {
    message: 'Provide at least one of `requirement` or `budget`',
  });
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequestSchema>;

export const RestartGoalRequestSchema = z.object({
  /** Optional new agent for every unfinished task node. */
  agentId: z.string().min(1).optional(),
});
export type RestartGoalRequest = z.infer<typeof RestartGoalRequestSchema>;
