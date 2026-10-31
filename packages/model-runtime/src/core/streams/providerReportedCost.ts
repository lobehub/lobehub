import type { StreamContext } from './protocol';

const toReportedCost = (value: unknown): number | undefined => {
  const cost = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
};

/**
 * Reads the USD charge an aggregator reports for a call. OpenRouter sends `usage.cost` on every
 * API; Vercel AI Gateway sends `usage.cost` on Chat Completions and a decimal string in
 * `provider_metadata.gateway.cost` on Messages and Responses. The value can sit on the chunk
 * itself, on Anthropic `message_start.message`, or on Responses `response.completed.response`.
 */
export const readProviderReportedCost = (chunk: unknown): number | undefined => {
  if (!chunk || typeof chunk !== 'object') return undefined;
  const record = chunk as Record<string, any>;

  for (const source of [record, record.message, record.response]) {
    if (!source || typeof source !== 'object') continue;
    const cost =
      toReportedCost(source.usage?.cost) ?? toReportedCost(source.provider_metadata?.gateway?.cost);
    if (cost !== undefined) return cost;
  }

  return undefined;
};

/**
 * Keeps the provider-reported charge out of `usage`, which is streamed to clients and persisted
 * on messages, and hands it to `onFinal` through the server-side stream context instead.
 */
export const recordProviderReportedCost = (streamContext: StreamContext, chunk: unknown) => {
  const cost = readProviderReportedCost(chunk);
  if (cost !== undefined) streamContext.providerReportedCost = cost;
};
