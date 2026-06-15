export interface OperationUsageLike {
  cost?: number | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
}

export interface OperationUsageMetrics {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

interface OperationUsageMessage {
  id: string;
  role?: string;
  usage?: OperationUsageLike | null;
}

const normalizeNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
};

export const EMPTY_OPERATION_USAGE_METRICS: OperationUsageMetrics = {
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
};

export const mergeOperationUsageMetrics = (
  left?: Partial<OperationUsageMetrics> | null,
  right?: Partial<OperationUsageMetrics> | null,
): OperationUsageMetrics => ({
  totalCost: normalizeNumber(left?.totalCost) + normalizeNumber(right?.totalCost),
  totalInputTokens:
    normalizeNumber(left?.totalInputTokens) + normalizeNumber(right?.totalInputTokens),
  totalOutputTokens:
    normalizeNumber(left?.totalOutputTokens) + normalizeNumber(right?.totalOutputTokens),
  totalTokens: normalizeNumber(left?.totalTokens) + normalizeNumber(right?.totalTokens),
});

export const usageToOperationMetrics = (
  usage?: OperationUsageLike | null,
): OperationUsageMetrics => ({
  totalCost: normalizeNumber(usage?.cost),
  totalInputTokens: normalizeNumber(usage?.totalInputTokens),
  totalOutputTokens: normalizeNumber(usage?.totalOutputTokens),
  totalTokens: normalizeNumber(usage?.totalTokens),
});

export const addUsageToOperationMetrics = (
  metrics?: Partial<OperationUsageMetrics> | null,
  usage?: OperationUsageLike | null,
): OperationUsageMetrics => mergeOperationUsageMetrics(metrics, usageToOperationMetrics(usage));

export const hasOperationUsageMetrics = (
  metrics?: Partial<OperationUsageMetrics> | null,
): metrics is OperationUsageMetrics =>
  normalizeNumber(metrics?.totalCost) > 0 ||
  normalizeNumber(metrics?.totalInputTokens) > 0 ||
  normalizeNumber(metrics?.totalOutputTokens) > 0 ||
  normalizeNumber(metrics?.totalTokens) > 0;

export const calculateOperationUsageMetrics = (
  messages: OperationUsageMessage[],
  operationIds: Set<string>,
  operationsByMessage: Record<string, string[]>,
): OperationUsageMetrics => {
  if (operationIds.size === 0) return EMPTY_OPERATION_USAGE_METRICS;

  let metrics: OperationUsageMetrics = EMPTY_OPERATION_USAGE_METRICS;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    const messageOperationIds = operationsByMessage[message.id];
    if (!messageOperationIds?.some((id) => operationIds.has(id))) continue;

    metrics = addUsageToOperationMetrics(metrics, message.usage);
  }

  return metrics;
};
