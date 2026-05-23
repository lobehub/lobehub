import { isPlainRecord } from '@lobechat/utils';

const HIGH_SURROGATE_START = 0xd8_00;
const HIGH_SURROGATE_END = 0xdb_ff;
const LOW_SURROGATE_START = 0xdc_00;
const LOW_SURROGATE_END = 0xdf_ff;

const isHighSurrogate = (codeUnit: number) =>
  codeUnit >= HIGH_SURROGATE_START && codeUnit <= HIGH_SURROGATE_END;

const isLowSurrogate = (codeUnit: number) =>
  codeUnit >= LOW_SURROGATE_START && codeUnit <= LOW_SURROGATE_END;

const sanitizeDeepSeekJsonString = (value: string) => {
  let sanitized = '';
  let index = 0;

  while (index < value.length) {
    const codeUnit = value.charCodeAt(index);
    const nextCodeUnit = value.charCodeAt(index + 1);

    if (isHighSurrogate(codeUnit)) {
      if (isLowSurrogate(nextCodeUnit)) {
        sanitized += value[index] + value[index + 1];
        index += 2;
        continue;
      }

      index += 1;
      continue;
    }

    if (isLowSurrogate(codeUnit)) {
      index += 1;
      continue;
    }

    sanitized += value[index];
    index += 1;
  }

  return sanitized;
};

const setIfChanged = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (value === source[key]) return target;

  return {
    ...target,
    [key]: value,
  };
};

const sanitizeToolUseInput = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeDeepSeekJsonString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeToolUseInput(item));
  if (!isPlainRecord(value)) return value;

  let sanitized = value;

  for (const [key, item] of Object.entries(value)) {
    sanitized = setIfChanged(sanitized, value, key, sanitizeToolUseInput(item));
  }

  return sanitized;
};

const sanitizeContentSurface = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeDeepSeekJsonString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeContentSurface(item));
  if (!isPlainRecord(value)) return value;

  let sanitized = value;

  if (typeof value.text === 'string') {
    sanitized = setIfChanged(sanitized, value, 'text', sanitizeDeepSeekJsonString(value.text));
  }

  if (typeof value.thinking === 'string') {
    sanitized = setIfChanged(
      sanitized,
      value,
      'thinking',
      sanitizeDeepSeekJsonString(value.thinking),
    );
  }

  if ('content' in value) {
    sanitized = setIfChanged(sanitized, value, 'content', sanitizeContentSurface(value.content));
  }

  if (value.type === 'tool_use' && 'input' in value) {
    sanitized = setIfChanged(sanitized, value, 'input', sanitizeToolUseInput(value.input));
  }

  return sanitized;
};

const sanitizeToolCalls = (toolCalls: unknown) => {
  if (!Array.isArray(toolCalls)) return toolCalls;

  return toolCalls.map((toolCall) => {
    if (!isPlainRecord(toolCall) || !isPlainRecord(toolCall.function)) return toolCall;

    const sanitizedArguments =
      typeof toolCall.function.arguments === 'string'
        ? sanitizeDeepSeekJsonString(toolCall.function.arguments)
        : toolCall.function.arguments;
    const sanitizedFunction = setIfChanged(
      toolCall.function,
      toolCall.function,
      'arguments',
      sanitizedArguments,
    );

    return setIfChanged(toolCall, toolCall, 'function', sanitizedFunction);
  });
};

const sanitizeMessage = (message: unknown) => {
  if (!isPlainRecord(message)) return message;

  let sanitized = message;

  if ('content' in message) {
    sanitized = setIfChanged(
      sanitized,
      message,
      'content',
      sanitizeContentSurface(message.content),
    );
  }

  if (typeof message.reasoning_content === 'string') {
    sanitized = setIfChanged(
      sanitized,
      message,
      'reasoning_content',
      sanitizeDeepSeekJsonString(message.reasoning_content),
    );
  }

  if ('tool_calls' in message) {
    sanitized = setIfChanged(
      sanitized,
      message,
      'tool_calls',
      sanitizeToolCalls(message.tool_calls),
    );
  }

  return sanitized;
};

/**
 * DeepSeek's official Anthropic endpoint rejects lone UTF-16 surrogate escapes
 * at the JSON parser layer. Keep this scoped to request text surfaces instead
 * of walking the whole payload, so schema/options objects are not rewritten.
 */
export const sanitizeDeepSeekJsonPayload = <T>(value: T): T => {
  if (!isPlainRecord(value)) return value;

  let sanitized: Record<string, unknown> = value;

  if (Array.isArray(value.messages)) {
    sanitized = setIfChanged(sanitized, value, 'messages', value.messages.map(sanitizeMessage));
  }

  if ('system' in value) {
    sanitized = setIfChanged(sanitized, value, 'system', sanitizeContentSurface(value.system));
  }

  return sanitized as T;
};
