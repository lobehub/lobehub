import type { TFunction } from 'i18next';

export interface AuthErrorLike {
  code?: string;
  /** Whole days until the request may succeed, attached by some server guards */
  retryAfterDays?: number;
}

/**
 * Translate a Better Auth error code through the `authError` namespace. Returns an empty
 * string for unknown codes so callers fall back to their own actionable copy instead of
 * showing the raw, untranslated server message.
 */
export const translateAuthError = (
  error: AuthErrorLike | null | undefined,
  t: TFunction<['auth', 'authError']>,
) => {
  const code = error?.code;
  if (!code) return '';

  const retryAfterDays = error.retryAfterDays;
  if (
    typeof retryAfterDays === 'number' &&
    Number.isSafeInteger(retryAfterDays) &&
    retryAfterDays > 0
  ) {
    const withDays = t(`authError:codes.${code}_WITH_RETRY_AFTER_DAYS`, {
      count: retryAfterDays,
      defaultValue: '',
    });
    if (withDays) return withDays;
  }

  return t(`authError:codes.${code}`, { defaultValue: '' });
};
