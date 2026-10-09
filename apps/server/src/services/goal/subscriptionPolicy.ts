import type {
  GoalSubscriptionFreshnessPolicy,
  GoalSubscriptionWakeCondition,
} from '@lobechat/types';
import { toMetricScale } from '@lobechat/types';
import { z } from 'zod';

export const subscriptionPolicySchema = z.object({
  freshnessPolicy: z
    .object({
      maxAgeMs: z.number().finite().positive(),
      maxFutureSkewMs: z.number().finite().nonnegative(),
    })
    .strict(),
  wakeCondition: z.discriminatedUnion('type', [
    z
      .object({
        minimumPlanningIntervalMs: z.number().finite().positive().optional(),
        type: z.literal('each_valid_run'),
      })
      .strict(),
    z
      .object({
        minimumPlanningIntervalMs: z.number().finite().positive().optional(),
        type: z.literal('observation_window'),
        intervalMs: z.number().finite().positive(),
      })
      .strict(),
    z
      .object({
        minimumPlanningIntervalMs: z.number().finite().positive().optional(),
        type: z.literal('threshold'),
        op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
        target: z.number().finite(),
      })
      .strict(),
    z
      .object({
        minimumPlanningIntervalMs: z.number().finite().positive().optional(),
        type: z.literal('change'),
        minimumAbsoluteChange: z.number().finite().nonnegative(),
      })
      .strict(),
  ]),
});

export const freshObservation = (
  observedAt: string | Date,
  policy: GoalSubscriptionFreshnessPolicy,
  now: number,
) => {
  const age = now - new Date(observedAt).getTime();
  return Number.isFinite(age) && age <= policy.maxAgeMs && age >= -policy.maxFutureSkewMs;
};

export const subscriptionWakes = (
  condition: GoalSubscriptionWakeCondition,
  value: number | undefined,
  previous: number | undefined,
  lastWakeAt: string | undefined,
  now: number,
) => {
  switch (condition.type) {
    case 'each_valid_run':
      return true;
    case 'observation_window':
      return now >= (lastWakeAt ? Date.parse(lastWakeAt) : now) + condition.intervalMs;
    case 'change':
      return (
        value !== undefined &&
        previous !== undefined &&
        Math.abs(value - previous) >= condition.minimumAbsoluteChange
      );
    case 'threshold': {
      if (value === undefined) return false;
      value = toMetricScale(value);
      const target = toMetricScale(condition.target);
      switch (condition.op) {
        case 'gte':
          return value >= target;
        case 'lte':
          return value <= target;
        case 'gt':
          return value > target;
        case 'lt':
          return value < target;
        case 'eq':
          return value === target;
      }
    }
  }
};

export const planningInterval = (condition: GoalSubscriptionWakeCondition) =>
  condition.minimumPlanningIntervalMs ??
  (condition.type === 'observation_window' ? condition.intervalMs : 60_000);
