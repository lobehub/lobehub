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
  [Plans.Plus]: Plans.Pro,
  [Plans.Premium]: Plans.Ultimate,
  [Plans.Pro]: Plans.Max,
  [Plans.Starter]: Plans.Premium,
};

export const getNextUpgradePlan = (plan?: Plans): Plans | undefined =>
  plan ? PLAN_UPGRADE_PATH[plan] : undefined;

/** Credits are displayed in units of 1M */
const CREDIT_UNIT = 1_000_000;

/** Smallest amount the 4-decimal display shows as nonzero. */
const MIN_DISPLAY_USD = 0.0001;

const formatUsd = (value: number): string =>
  `$${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 1 ? 4 : 2,
    minimumFractionDigits: 2,
  }).format(value)}`;

/**
 * Budget figures arrive as credits (1M = $1); users only ever see dollars.
 * A positive amount that would round to $0.0000 (1-49 credits) reads `<$0.0001`
 * so it does not look free.
 */
export const formatCreditAmount = (credits: number): string => {
  const usd = credits / CREDIT_UNIT;
  const magnitude = Math.abs(usd);

  if (magnitude > 0 && magnitude < MIN_DISPLAY_USD / 2) {
    return `${usd < 0 ? '-' : ''}<${formatUsd(MIN_DISPLAY_USD)}`;
  }

  return formatUsd(usd);
};
