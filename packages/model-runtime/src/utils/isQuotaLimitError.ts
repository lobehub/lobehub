const QUOTA_LIMIT_PATTERNS = [
  'resource exhausted', // Google / VertexAI
  'resource has been exhausted', // Google
  'rate limit reached', // OpenAI
  'rate_limit_exceeded', // OpenAI (code in message)
  'quota exceeded', // generic
  'too many requests', // generic
];

export const isQuotaLimitError = (message?: string): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return QUOTA_LIMIT_PATTERNS.some((p) => lower.includes(p));
};
