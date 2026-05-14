export type ChatCompletionPayload = Record<string, any> & {
  messages?: Array<Record<string, any>>;
  model?: string;
  provider?: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * 判断当前请求是否需要 Kimi 兼容处理。
 */
export function isKimiNewApi(providerId: string | undefined, model: string | undefined): boolean {
  return providerId === 'newapi' && typeof model === 'string' && model.startsWith('kimi-');
}

const normalizeAssistantHistoryMessage = (message: Record<string, any>) => {
  if (message.role !== 'assistant') return message;

  const normalized = { ...message };
  const structuredReasoning = normalized.reasoning?.content;

  if (
    normalized.reasoning_content === undefined &&
    Array.isArray(normalized.tool_calls) &&
    normalized.tool_calls.length > 0 &&
    isNonEmptyString(structuredReasoning)
  ) {
    normalized.reasoning_content = structuredReasoning;
  }

  if (
    normalized.reasoning_content !== undefined &&
    !isNonEmptyString(normalized.reasoning_content)
  ) {
    delete normalized.reasoning_content;
  }

  delete normalized.reasoning;

  return normalized;
};

/**
 * 在最终请求发出前调整 payload，处理所有 Kimi 兼容问题。
 * 仅对 provider=newapi + model 以 kimi- 开头时生效。
 */
export function applyKimiCompat<T extends ChatCompletionPayload>(
  payload: T,
  providerId = payload.provider,
): T {
  if (!isKimiNewApi(providerId, payload.model)) return payload;

  const { thinking: _thinking, ...restPayload } = payload;

  return {
    ...restPayload,
    messages: Array.isArray(payload.messages)
      ? payload.messages.map((message) => normalizeAssistantHistoryMessage(message))
      : payload.messages,
  } as T;
}
