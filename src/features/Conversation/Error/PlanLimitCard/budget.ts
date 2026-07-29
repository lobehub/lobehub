import { Plans } from '@lobechat/types';

export type PlanLimitPricingBasis = 'approximate' | 'estimated' | 'exact' | 'unknown';

/**
 * Budget context snapshot attached to plan-limit error bodies by the server.
 * Only the fields needed for the lightweight fallback card are typed here.
 */
export interface PlanLimitBudgetContext {
  modelId?: string;
  planAtError?: string;
  pricingBasis?: PlanLimitPricingBasis;
  providerId?: string;
  requiredCredits?: number;
  shortfallCredits?: number;
}

export const getBudgetContextFromErrorBody = (
  body: unknown,
): PlanLimitBudgetContext | undefined => {
  const budget = (body as { budget?: PlanLimitBudgetContext } | null | undefined)?.budget;
  return budget && typeof budget === 'object' ? budget : undefined;
};

const PLAN_VALUES = new Set<string>(Object.values(Plans));

export const isKnownPlan = (plan?: string): plan is Plans => !!plan && PLAN_VALUES.has(plan);

const PLAN_UPGRADE_PATH: Partial<Record<Plans, Plans>> = {
  [Plans.Free]: Plans.Starter,
  [Plans.Premium]: Plans.Ultimate,
  [Plans.Starter]: Plans.Premium,
};

export const getNextUpgradePlan = (plan?: Plans): Plans | undefined =>
  plan ? PLAN_UPGRADE_PATH[plan] : undefined;
