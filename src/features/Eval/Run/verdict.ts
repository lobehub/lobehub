/**
 * A case result reduced to the one word people scan the table for. `error`
 * folds in `timeout`; `pending` folds in a missing status.
 */
export type CaseVerdict =
  'completed' | 'error' | 'external' | 'failed' | 'passed' | 'pending' | 'running';

/** Verdict filters, in the order they are offered. */
export const VERDICT_FILTERS = [
  'passed',
  'failed',
  'error',
  'running',
  'pending',
  'external',
  'completed',
] as const satisfies readonly CaseVerdict[];

export const getCaseVerdict = (status?: string | null): CaseVerdict => {
  switch (status) {
    case 'passed':
    case 'failed':
    case 'running':
    case 'external':
    case 'completed': {
      return status;
    }
    case 'error':
    case 'timeout': {
      return 'error';
    }
    default: {
      return 'pending';
    }
  }
};

export const countVerdicts = (results: { status?: string | null }[]) => {
  const counts: Record<CaseVerdict, number> = {
    completed: 0,
    error: 0,
    external: 0,
    failed: 0,
    passed: 0,
    pending: 0,
    running: 0,
  };
  for (const r of results) counts[getCaseVerdict(r.status)]++;
  return counts;
};

const MESSAGE_KEYS = ['message', 'error', 'reason', 'detail'] as const;

const pickMessage = (value: unknown, depth = 0): string | undefined => {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value !== 'object') return String(value);
  for (const key of MESSAGE_KEYS) {
    const found = pickMessage((value as Record<string, unknown>)[key], depth + 1);
    if (found) return found;
  }
};

/**
 * Turn whatever the runtime stored as a case error into one readable sentence:
 * unwraps JSON envelopes (`{"error":{"message":…}}`) and keeps plain text as is.
 */
export const formatErrorReason = (error: unknown): string | undefined => {
  if (error === null || error === undefined) return;
  if (typeof error === 'string') {
    const text = error.trim();
    if (!text) return;
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return pickMessage(JSON.parse(text)) ?? text;
      } catch {
        return text;
      }
    }
    return text;
  }
  return pickMessage(error) ?? JSON.stringify(error);
};
