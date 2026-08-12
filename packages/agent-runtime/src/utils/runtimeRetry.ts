const DEFAULT_LLM_MAX_RETRIES = 5;
const DEFAULT_LLM_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_LLM_RETRY_MAX_DELAY_MS = 30_000;

export type RuntimeRetryKind = 'retry' | 'stop';
export type RuntimeToolFailureKind = 'replan' | 'retry' | 'stop';

export interface LLMRetryPolicyOptions {
  maxRetries?: number;
  noRetryProviders?: readonly string[];
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface RetryableToolResult {
  error?: unknown;
  success: boolean;
}

export interface ExecuteToolWithRetryParams {
  isInterrupted?: () => Promise<boolean>;
  maxRetries: number;
  onRetry?: (info: {
    attempt: number;
    kind: RuntimeToolFailureKind;
    maxAttempts: number;
  }) => Promise<void> | void;
}

const resolveLLMMaxRetries = (provider: string, options: LLMRetryPolicyOptions = {}) =>
  options.noRetryProviders?.includes(provider)
    ? 0
    : (options.maxRetries ?? DEFAULT_LLM_MAX_RETRIES);

export const shouldRetryLLM = (kind: RuntimeRetryKind, attempt: number, maxRetries: number) =>
  kind === 'retry' && attempt <= maxRetries;

export const resolveLLMRetryBudget = (provider: string, options: LLMRetryPolicyOptions = {}) =>
  resolveLLMMaxRetries(provider, options);

export const resolveLLMMaxAttempts = (provider: string, options: LLMRetryPolicyOptions = {}) =>
  resolveLLMMaxRetries(provider, options) + 1;

export const getLLMRetryDelayMs = (attempt: number, options: LLMRetryPolicyOptions = {}) =>
  Math.min(
    (options.retryBaseDelayMs ?? DEFAULT_LLM_RETRY_BASE_DELAY_MS) * 2 ** Math.max(attempt - 1, 0),
    options.retryMaxDelayMs ?? DEFAULT_LLM_RETRY_MAX_DELAY_MS,
  );

const getToolFailureKind = (result: RetryableToolResult): RuntimeToolFailureKind | undefined => {
  if (!result.error || typeof result.error !== 'object') return;

  const { kind } = result.error as { kind?: unknown };
  return kind === 'replan' || kind === 'retry' || kind === 'stop' ? kind : undefined;
};

export const executeToolWithRetry = async <TResult extends RetryableToolResult>(
  execute: () => Promise<TResult>,
  params: ExecuteToolWithRetryParams,
): Promise<{ attempts: number; result: TResult }> => {
  const maxAttempts = params.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await execute();

    if (result.success) return { attempts: attempt, result };

    const kind = getToolFailureKind(result);

    if (kind === 'retry' && attempt <= params.maxRetries) {
      if (await params.isInterrupted?.()) {
        return { attempts: attempt, result };
      }

      await params.onRetry?.({ attempt, kind, maxAttempts });
      continue;
    }

    return { attempts: attempt, result };
  }

  throw new Error('Tool execution retry loop exited unexpectedly');
};
