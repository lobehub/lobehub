import { Plans } from '@lobechat/types';
import { isRecord } from '@lobechat/utils';

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
  if (!isRecord(body)) return undefined;

  const { budget } = body as { budget?: unknown };
  if (!isRecord(budget)) return undefined;

  return budget as PlanLimitBudgetContext;
};

export const isFableCampaignLimitContext = (context?: PlanLimitBudgetContext): boolean =>
  context?.modelId === 'claude-fable-5' && context.providerId === 'lobehub';

const PLAN_VALUES = new Set<string>(Object.values(Plans));

export const isKnownPlan = (plan?: string): plan is Plans => !!plan && PLAN_VALUES.has(plan);

const PLAN_UPGRADE_PATH: Partial<Record<Plans, Plans>> = {
  [Plans.Free]: Plans.Starter,
  [Plans.Premium]: Plans.Ultimate,
  [Plans.Starter]: Plans.Premium,
};

export const getNextUpgradePlan = (plan?: Plans): Plans | undefined =>
  plan ? PLAN_UPGRADE_PATH[plan] : undefined;
