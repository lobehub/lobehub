import type { Cost, Usage } from '@lobechat/agent-runtime';
import type { WorkVersionCumulativeUsage } from '@lobechat/types';

const finiteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const getWorkVersionTotalTokens = (
  cumulativeUsage?: WorkVersionCumulativeUsage | null,
): number | null => {
  const usage = cumulativeUsage?.usage;
  if (!isRecord(usage) || !isRecord(usage.llm) || !isRecord(usage.llm.tokens)) return null;

  const total = usage.llm.tokens.total;
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null;
};

export const buildWorkVersionCumulativeUsage = ({
  cost,
  now = new Date(),
  usage,
}: {
  cost?: Cost | null;
  now?: Date;
  usage?: Usage | null;
}): { cumulativeCost: number | null; cumulativeUsage: WorkVersionCumulativeUsage | null } => ({
  cumulativeCost: finiteNumberOrNull(cost?.total),
  cumulativeUsage:
    cost || usage
      ? {
          capturedAt: now.toISOString(),
          cost: cost ?? null,
          usage: usage ?? null,
        }
      : null,
});
