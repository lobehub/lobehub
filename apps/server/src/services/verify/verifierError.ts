/**
 * Codes (and the bare message the credit gate throws) for a verifier model call
 * refused because the account has no spendable credits. A retry fails the same
 * way until someone tops up, so this outcome must not start another attempt.
 */
const OUT_OF_CREDITS_PATTERN =
  /\b(?:InsufficientBudgetForModel|FreePlanLimit|SubscriptionPlanLimit|InsufficientQuota)\b|\bbudget exceeded\b/i;

/** Whether an errored check's recorded cause is a credit refusal. */
export const isOutOfCreditsFailure = (text?: string | null): boolean =>
  !!text && OUT_OF_CREDITS_PATTERN.test(text);

/**
 * Codes for a verifier model that cannot run as configured: the provider does not
 * serve the model, rejects the key, has no channel for it, or the model cannot
 * call the verdict tool. Like a credit refusal, a retry fails the same way until
 * someone changes the verify model.
 */
const SETUP_FAILURE_PATTERN =
  /\b(ModelNotFound|InvalidProviderAPIKey|NoAvailableProvider|NoAvailableChannel|AccountDeactivated|PermissionDenied|UserConfigError|CapabilityNotSupported)\b/;

/** The setup code an errored check's recorded cause names, if it is one no retry clears. */
export const verifierSetupFailureCode = (text?: string | null): string | undefined =>
  (text && SETUP_FAILURE_PATTERN.exec(text)?.[1]) || undefined;

/**
 * Error text with its stable code appended, so the recorded limitation can be
 * classified later without guessing from free-form prose ("Budget exceeded").
 */
export const withErrorType = (message: string | undefined, errorType?: string): string => {
  const text = message?.trim() ?? '';
  if (!errorType || text.includes(errorType)) return text || errorType || '';
  return text ? `${text} (${errorType})` : errorType;
};

/**
 * Describe a thrown model-runtime error. Those are plain payloads —
 * `{ errorType, error: { message } }` — so `String(error)` read "[object Object]"
 * and dropped the code.
 */
export const describeThrownError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const payload = error as {
      error?: { message?: unknown };
      errorType?: unknown;
      message?: unknown;
    };
    const message =
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : typeof payload.message === 'string'
          ? payload.message
          : undefined;
    const errorType = typeof payload.errorType === 'string' ? payload.errorType : undefined;
    const described = withErrorType(message, errorType);
    if (described) return described;
  }
  return String(error);
};
