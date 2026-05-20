const ACCOUNT_DEACTIVATED_PATTERNS = [
  'account has been deactivated', // OpenAI
  'account has been suspended', // generic
  'account has been disabled', // generic
  'account is disabled', // generic
];

export const isAccountDeactivatedError = (message?: string): boolean => {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ACCOUNT_DEACTIVATED_PATTERNS.some((p) => lower.includes(p));
};
