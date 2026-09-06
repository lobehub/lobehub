import { type ChatCompletionErrorPayload } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { classifyLLMError } from '@/server/modules/AgentRuntime/llmErrorClassification';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

// Retry wrapper — only effective for errors that surface BEFORE streaming
// starts (e.g. 429 / 5xx / 529 overloaded). Once a Response is returned we
// cannot rewind, so mid-stream errors still propagate as-is.
const DEFAULT_CHAT_MAX_RETRIES = 10;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15_000;
// Hard ceiling sits just below `maxDuration` so we never race the platform's
// kill signal while still sleeping for backoff.
const RETRY_BUDGET_MS = 270_000;

const parsePositiveInt = (raw: string | undefined, fallback: number, allowZero = false): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (allowZero ? parsed < 0 : parsed <= 0) return fallback;
  return parsed;
};

const parseMaxRetries = (): number =>
  parsePositiveInt(process.env.LLM_CHAT_MAX_RETRIES, DEFAULT_CHAT_MAX_RETRIES, true);

const parseBaseDelayMs = (): number =>
  parsePositiveInt(process.env.LLM_CHAT_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS);

const parseMaxDelayMs = (): number =>
  parsePositiveInt(process.env.LLM_CHAT_RETRY_MAX_DELAY_MS, DEFAULT_RETRY_MAX_DELAY_MS);

const computeBackoffMs = (attempt: number, baseMs: number, maxMs: number): number =>
  Math.min(baseMs * 2 ** (attempt - 1), maxMs);

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const POST = checkAuth(async (req: Request, { params, userId, serverDB }) => {
  const provider = (await params)!.provider!;
  const startedAt = Date.now();
  const maxRetries = parseMaxRetries();
  const maxAttempts = maxRetries + 1;
  const baseDelayMs = parseBaseDelayMs();
  // Ensure max >= base so backoff never grows smaller as we retry.
  const maxDelayMs = Math.max(parseMaxDelayMs(), baseDelayMs);

  try {
    const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });

    // ============  1. init chat model   ============ //
    const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, workspaceId);

    // ============  2. create chat completion   ============ //

    const data = (await req.json()) as ChatStreamPayload;

    const tracePayload = getTracePayload(req);

    let traceOptions = {};
    // If user enable trace
    if (tracePayload?.enabled) {
      traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Pre-flight budget check: if the total elapsed time already exceeds
      // the budget, skip this attempt so we never launch a provider call
      // that could push us past `maxDuration`.
      if (attempt > 1 && Date.now() - startedAt > RETRY_BUDGET_MS) break;

      try {
        return await modelRuntime.chat(data, {
          user: userId,
          ...traceOptions,
          signal: req.signal,
        });
      } catch (e) {
        lastError = e;

        // Exhausted attempts — fall through to unified error handler so the
        // response shape remains identical for existing clients.
        if (attempt >= maxAttempts) break;

        // Client disconnected — no point retrying for a gone peer.
        if (req.signal?.aborted) break;

        // Local JS errors (TypeError etc.) are never transient — skip classifier.
        if (e instanceof TypeError || e instanceof RangeError) break;

        const classified = classifyLLMError(e);
        if (classified.kind !== 'retry') break;

        const backoffMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
        const elapsed = Date.now() - startedAt;
        if (elapsed + backoffMs > RETRY_BUDGET_MS) {
          console.warn(
            `Route: [${provider}] retry budget exhausted after ${elapsed}ms (attempt ${attempt}/${maxAttempts}), giving up.`,
          );
          break;
        }

        console.warn(
          `Route: [${provider}] chat attempt ${attempt}/${maxAttempts} failed (${classified.code ?? 'unknown'}), retrying in ${backoffMs}ms: ${classified.message}`,
        );

        try {
          await sleep(backoffMs, req.signal);
        } catch {
          // Aborted mid-backoff — stop retrying.
          break;
        }
      }
    }

    throw lastError;
  } catch (e) {
    const {
      errorType = ChatErrorType.InternalServerError,
      error: errorContent,
      ...res
    } = e as ChatCompletionErrorPayload;

    const error = errorContent || e;

    // track the error at server side
    if (AGENT_RUNTIME_ERROR_SET.has(errorType as string)) {
      console.warn(`Route: [${provider}] ${errorType}:`, error);
    } else {
      console.error(`Route: [${provider}] ${errorType}:`, error);
    }

    return createErrorResponse(errorType, { error, ...res, provider });
  }
});
