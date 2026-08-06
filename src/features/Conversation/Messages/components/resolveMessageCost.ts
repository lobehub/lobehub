import { type ModelUsage } from '@lobechat/types';

/** Prefer structured `usage.cost`; fall back to deprecated flat `metadata.cost`. */
export const resolveMessageCost = (
  usage?: ModelUsage,
  metadata?: Record<string, unknown> | null,
): number | undefined => {
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) return usage.cost;
  const legacy = metadata?.cost;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy;
  return undefined;
};

export const formatMessageCostUsd = (cost: number) => `$${cost.toFixed(2)}`;
