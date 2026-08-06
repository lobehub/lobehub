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

/**
 * Format USD with micro-precision (up to 6 dp). Trims trailing zeros but keeps
 * at least 2 fractional digits so small OpenRouter charges stay accurate.
 */
export const formatMessageCostUsd = (cost: number): string => {
  if (!Number.isFinite(cost)) return '$0.00';
  const fixed = Math.abs(cost).toFixed(6);
  const [whole, frac = '000000'] = fixed.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const decimals = trimmed.length > 2 ? trimmed : frac.slice(0, 2);
  const sign = cost < 0 ? '-' : '';
  return `${sign}$${whole}.${decimals}`;
};
