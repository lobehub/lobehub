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

const PLAN_UPGRADE_PATH = {
  free: 'starter',
  premium: 'ultimate',
  starter: 'premium',
} as const;

export const getNextUpgradePlan = (
  plan?: string,
): (typeof PLAN_UPGRADE_PATH)[keyof typeof PLAN_UPGRADE_PATH] | undefined =>
  plan && Object.hasOwn(PLAN_UPGRADE_PATH, plan)
    ? PLAN_UPGRADE_PATH[plan as keyof typeof PLAN_UPGRADE_PATH]
    : undefined;
