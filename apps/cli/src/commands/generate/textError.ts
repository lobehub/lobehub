/** Longest raw non-JSON body excerpt printed with an HTTP error. */
const MAX_RAW_BODY_LENGTH = 200;

/** Finish reasons providers report when the output-token limit stopped the completion. */
const OUTPUT_LIMIT_FINISH_REASONS = new Set(['length', 'max_tokens', 'MAX_TOKENS']);

interface ChatErrorBody {
  body?: {
    /** `/webapi/chat/[provider]` serializes the error's diagnostics here. */
    diagnostics?: { finishReason?: unknown };
    error?: { message?: unknown };
    finishReason?: unknown;
    message?: unknown;
    traceId?: unknown;
  };
  errorType?: unknown;
}

const parseErrorBody = (text: string): ChatErrorBody | undefined => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as ChatErrorBody) : undefined;
  } catch {
    return undefined;
  }
};

const isHtml = (text: string) => /^\s*<(?:!doctype|html)/i.test(text);

/**
 * Turn a failed `/webapi/chat/*` response into one readable line. The route answers with
 * `{ errorType, body }`; an HTML error page or other raw text is summarized instead of dumped.
 */
export const formatTextGenerationError = (
  status: number,
  text: string,
  options: { maxTokens?: number } = {},
): string => {
  const parsed = parseErrorBody(text);

  if (!parsed || typeof parsed.errorType !== 'string') {
    if (isHtml(text)) {
      return `Text generation failed: HTTP ${status}. The server returned an HTML error page instead of an error message.`;
    }
    const excerpt = text.trim().slice(0, MAX_RAW_BODY_LENGTH);
    return `Text generation failed: HTTP ${status}${excerpt ? ` ${excerpt}` : ''}`;
  }

  const { body, errorType } = parsed;
  const parts = [`Text generation failed: ${errorType} (HTTP ${status}).`];

  if (errorType === 'ModelEmptyCompletion') {
    parts.push('The model returned no visible output.');
    // `/webapi/chat/lobehub` puts the finish reason on the body; `/webapi/chat/[provider]` keeps it
    // in the serialized error diagnostics.
    const rawFinishReason = body?.finishReason ?? body?.diagnostics?.finishReason;
    const finishReason = typeof rawFinishReason === 'string' ? rawFinishReason : undefined;
    if (finishReason && OUTPUT_LIMIT_FINISH_REASONS.has(finishReason)) {
      parts.push(
        `It reached the output-token limit${options.maxTokens ? ` (--max-tokens ${options.maxTokens})` : ''} before writing any text; reasoning can use up the budget. Raise --max-tokens and retry.`,
      );
    } else if (options.maxTokens) {
      parts.push(`If reasoning used up --max-tokens ${options.maxTokens}, raise it and retry.`);
    }
  } else {
    const message = body?.message ?? body?.error?.message;
    if (typeof message === 'string' && message) parts.push(message);
  }

  if (typeof body?.traceId === 'string') parts.push(`Trace ID: ${body.traceId}`);

  return parts.join(' ');
};
