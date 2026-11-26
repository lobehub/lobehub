import type { TFunction } from 'i18next';

import { translateAuthError } from '../utils/translateAuthError';

export interface SignUpErrorLike {
  code?: string;
  details?: {
    cause?: {
      code?: string;
    };
  };
  message?: string;
  retryAfterDays?: number;
}

export interface ResolvedSignUpError {
  /**
   * Form field the error belongs to. Field errors render under that input and clear as
   * soon as the user edits it; errors without a field render next to the submit button.
   */
  field?: 'email' | 'password';
  message: string;
}

/** Server rejections that the user fixes by changing the email address */
const EMAIL_ERROR_CODES = new Set([
  'BLOCKED_DOMAIN',
  'BLOCKED_MULTI_LEVEL_DOMAIN',
  'DELETED_ACCOUNT_EMAIL',
  'EMAIL_NOT_ALLOWED',
  'INVALID_EMAIL',
  'TEMPORARY_EMAIL_NOT_ALLOWED',
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
]);

/** Server rejections that the user fixes by changing the password */
const PASSWORD_ERROR_CODES = new Set([
  'INVALID_PASSWORD',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_SHORT',
]);

/**
 * Map a Better Auth sign-up rejection to copy that tells the user what to do next, and to
 * the form field it should sit under. Raw server messages are untranslated and often bare
 * error codes, so they never reach the UI.
 */
export const resolveSignUpError = (
  error: SignUpErrorLike,
  t: TFunction<['auth', 'authError']>,
): ResolvedSignUpError => {
  const isEmailDuplicate =
    error.code === 'FAILED_TO_CREATE_USER' && error.details?.cause?.code === '23505';
  if (isEmailDuplicate || error.code === 'USER_ALREADY_EXISTS') {
    return { field: 'email', message: t('betterAuth.errors.emailRegistered') };
  }

  if (error.code === 'INVALID_EMAIL' || error.message === 'Invalid email') {
    return { field: 'email', message: t('betterAuth.errors.signupEmailInvalid') };
  }

  const translated = translateAuthError(error, t);
  if (translated && error.code) {
    if (EMAIL_ERROR_CODES.has(error.code)) return { field: 'email', message: translated };
    if (PASSWORD_ERROR_CODES.has(error.code)) return { field: 'password', message: translated };
    return { message: translated };
  }

  console.error('Unhandled sign up error:', error);
  return { message: t('betterAuth.signup.failed') };
};
