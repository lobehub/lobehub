const INSUFFICIENT_QUOTA_PATTERNS = [
  'insufficient balance', // Moonshot / generic
  'insufficient quota', // OpenAI
  'account is suspended due to insufficient balance', // Moonshot
  'balance is not enough', // generic
  'billing hard limit has been reached', // OpenAI
  'exceeded your current quota', // OpenAI
];

export const isInsufficientQuotaError = (message?: string): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return INSUFFICIENT_QUOTA_PATTERNS.some((p) => lower.includes(p));
};
