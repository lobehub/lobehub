import { GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import { z } from 'zod';

import { MAX_ROLLOUT_ROSTER } from '../rolloutBatch';
import { goalWaitSchema } from '../wait';

const reason = z.string().trim().min(1).max(8000);
/** Node ids or titles of the reviewed units a revised plan runs again; omitted, all of them. */
const rerun = z.array(z.string().trim().min(1)).max(60).optional();
/**
 * The question an escalation puts to the owner. A bare reason left the gate
 * asking "retry or retire?" while the decision that actually blocked the goal —
 * waive a criterion, restore a closed PR — was buried in its text with no
 * button to answer it.
 */
/**
 * Option ids the coordinator and the planner own. Their gates are labelled by
 * id on the goal page and in the inbox, so an authored answer reusing one would
 * show the coordinator's label ("Retry task") over a different consequence.
 */
const RESERVED_ASK_OPTION_IDS = new Set<string>([
  'fail',
  'retire',
  'retry',
  ...Object.values(GOAL_CLARIFICATION_OPTION),
]);

const goalAskSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    options: z
      .array(
        z
          .object({
            id: z
              .string()
              .trim()
              .regex(/^[\w-]{1,40}$/),
            label: z.string().trim().min(1).max(120),
            description: z.string().trim().max(600).optional(),
            effect: z.enum(['retry', 'retire']).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    recommendedOptionId: z.string().trim().optional(),
  })
  .strict()
  .refine((ask) => new Set(ask.options.map((option) => option.id)).size === ask.options.length, {
    message: 'Option ids must be unique',
  })
  .refine((ask) => ask.options.every((option) => !RESERVED_ASK_OPTION_IDS.has(option.id)), {
    message: `Option ids ${[...RESERVED_ASK_OPTION_IDS].join(', ')} are reserved; name the answer itself (e.g. "waive")`,
  })
  .refine(
    (ask) =>
      !ask.recommendedOptionId ||
      ask.options.some((option) => option.id === ask.recommendedOptionId),
    { message: 'recommendedOptionId must name one of the options' },
  );
export const planRolloutSchema = z
  .object({
    /** The one reusable recipe every unit follows; the batch's Template, revised on every break. */
    recipe: reason,
    /** Every unit after the probes in `tasks`, in delivery order; a unit may carry its own notes. */
    units: z
      .array(
        z.union([
          z.string().trim().min(1).max(255),
          z
            .object({
              title: z.string().trim().min(1).max(255),
              description: z.string().trim().max(8000).optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(MAX_ROLLOUT_ROSTER),
    /** Axes the units vary along; the gate holds until the probes cover every value. */
    variants: z
      .array(
        z
          .object({
            axis: z.string().trim().min(1).max(120),
            values: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();
export const goalPlanSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('tasks'),
      reason,
      tasks: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(255),
            description: reason,
            /**
             * What this task builds on: an existing task node ID from the Goal
             * graph, or the 0-based index of an earlier task in this same plan.
             * Becomes a `depends_on` edge, which both gates dispatch and lays
             * the graph out round by round instead of as one flat row.
             */
            dependsOn: z
              .array(z.union([z.number().int().min(0), z.string().trim().min(1)]))
              .max(20)
              .optional(),
          }),
        )
        .min(1)
        .max(10),
      /**
       * Declares the work one repeated mould and delivers it as a batch (STAMP):
       * `tasks` become the probes that run first, the units below wait, and the
       * coordinator releases them wave by wave once the gate shows the probes ran
       * through without a person. Whether the work is one mould is the main
       * Agent's judgement; the server only checks the declaration is well formed.
       */
      rollout: planRolloutSchema.optional(),
    })
    .strict(),
  z.object({ action: z.literal('verify'), reason }).strict(),
  z.object({ action: z.literal('wait'), reason, ...goalWaitSchema.shape }).strict(),
  z
    .object({
      action: z.literal('retry'),
      reason,
      taskId: z.string().min(1),
      failedOperationId: z.string().min(1),
    })
    .strict(),
  z.object({ action: z.literal('escalate'), reason, ask: goalAskSchema.optional() }).strict(),
  /** Answers a batch release handed over by the coordinator: the next wave goes out. */
  z.object({ action: z.literal('release'), reason }).strict(),
  /** Answers a plan sent back: the full revised recipe, and the reviewed units to re-run. */
  z.object({ action: z.literal('revise_plan'), reason, recipe: reason, rerun }).strict(),
]);
export type GoalPlan = z.infer<typeof goalPlanSchema>;
