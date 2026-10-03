import { isRecord } from './object';

export const BLOCKED_TOOL_RESULT_CONTENT = 'Tool result withheld by afterToolCall hook.';
export const PENDING_TOOL_RESULT_CONTENT = 'Tool result awaiting afterToolCall review.';

/** Keep billing facts without carrying result text, images, errors, or resource references. */
export function pickToolResultUsage(state: unknown): Record<string, number> {
  const usage: Record<string, number> = {};
  if (!isRecord(state)) return usage;
  for (const key of [
    'totalCost',
    'totalInputTokens',
    'totalOutputTokens',
    'totalToolCalls',
    'totalTokens',
  ]) {
    const value = state[key];
    if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
  }
  return usage;
}
