const CONTEXT_WINDOW_PATTERNS = [
  'maximum context length', // OpenAI/DeepSeek
  'context length exceeded', // OpenAI
  'context_length_exceeded', // OpenAI (code in message)
  'context window exceeds', // MiniMax non-streaming
  'exceeds the context window', // Aihubmix / generic
  'prompt is too long', // Anthropic
  'input is too long', // Anthropic
  'input tokens exceed the configured limit', // OpenAI-compatible providers / wrapped upstream errors
  'too many input tokens', // Bedrock
  'exceeds the maximum number of tokens', // Google
  'maximum allowed number of input tokens',
  'request too large for model',
];

export const isExceededContextWindowError = (message?: string): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return CONTEXT_WINDOW_PATTERNS.some((p) => lower.includes(p));
};
