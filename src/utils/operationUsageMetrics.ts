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
  /** Owning assistant message — how a tool row is attributed to an operation. */
  parentId?: string | null;
  plugin?: { identifier?: string } | null;
  pluginState?: SubAgentSpend | null;
  role?: string;
  usage?: OperationUsageLike | null;
}

/**
 * A finished sub-agent's spend, as the completion bridge writes it onto the
 * `callSubAgent` tool message — plus the live totals streamed while it runs.
 */
interface SubAgentSpend {
  progress?: SubAgentSpend | null;
  totalCost?: number | null;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  totalTokens?: number | null;
}

/**
 * The builtin whose tool messages anchor a forked child run.
 *
 * A sub-agent's own assistant messages live in an isolation thread the parent
 * never loads, so they can never reach this sum. Its `callSubAgent` tool message
 * — which DOES sit in the parent's list — is where the child's spend enters the
 * parent's ledger.
 */
const SUB_AGENT_TOOL_IDENTIFIER = 'lobe-agent';

const subAgentSpendToMetrics = (state?: SubAgentSpend | null): OperationUsageMetrics => {
  // The flat fields are the authoritative totals the bridge backfills when the
  // child finishes; `progress` holds the live ones streamed while it runs. Prefer
  // the former so the tray can't regress to a stale sample once the run ends.
  const spend =
    state?.totalTokens === undefined && state?.totalCost === undefined ? state?.progress : state;

  return {
    totalCost: normalizeNumber(spend?.totalCost),
    totalInputTokens: normalizeNumber(spend?.totalInputTokens),
    totalOutputTokens: normalizeNumber(spend?.totalOutputTokens),
    totalTokens: normalizeNumber(spend?.totalTokens),
  };
};

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

  const belongsToOperation = (messageId?: string | null): boolean =>
    !!messageId && !!operationsByMessage[messageId]?.some((id) => operationIds.has(id));

  for (const message of messages) {
    if (message.role === 'assistant') {
      if (!belongsToOperation(message.id)) continue;

      metrics = addUsageToOperationMetrics(metrics, message.usage);
      continue;
    }

    // A sub-agent's spend, folded in via its `callSubAgent` tool row. Attributed
    // through `parentId` — the assistant turn that made the call — because only
    // assistant messages are registered in `operationsByMessage`; a tool row is
    // never a key there.
    if (
      message.role === 'tool' &&
      message.plugin?.identifier === SUB_AGENT_TOOL_IDENTIFIER &&
      belongsToOperation(message.parentId)
    ) {
      metrics = mergeOperationUsageMetrics(metrics, subAgentSpendToMetrics(message.pluginState));
    }
  }

  return metrics;
};
