import {
  AICO_ERROR_MESSAGES_FA,
  type AicoErrorCode,
  resolveAicoErrorCode,
} from '@lobechat/business-const';
import { toast } from '@lobehub/ui/base-ui';

import { buildPhoneVerifyRedirectUrl } from '@/libs/better-auth/phone';

type LooseT = (key: string, options?: { defaultValue?: string }) => string;

/** Pull a likely error-code string out of TRPC / Error / plain shapes. */
export const extractErrorCodeCandidate = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return '';

  const candidate = error as {
    data?: { message?: unknown };
    message?: unknown;
    shape?: { message?: unknown };
  };

  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message;
  }
  if (typeof candidate.data?.message === 'string') return candidate.data.message;
  if (typeof candidate.shape?.message === 'string') return candidate.shape.message;
  return '';
};

/**
 * Map a thrown Aico error code to localized UI copy.
 * Returns `undefined` when the value is not a known Aico code (caller keeps its fallback).
 */
export const resolveAicoErrorMessage = (errorOrCode: unknown, t?: LooseT): string | undefined => {
  const raw =
    typeof errorOrCode === 'string' ? errorOrCode : extractErrorCodeCandidate(errorOrCode);
  const code = resolveAicoErrorCode(raw);
  if (!code) return undefined;

  const faDefault = AICO_ERROR_MESSAGES_FA[code as AicoErrorCode];
  if (!t) return faDefault;
  return t(`errors.${code}`, { defaultValue: faDefault });
};

const navigateToPhoneVerify = (callbackUrl?: string) => {
  const target =
    callbackUrl ||
    (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/');
  window.location.assign(buildPhoneVerifyRedirectUrl(target));
};

/** Toast a known Aico code, otherwise the caller's fallback key. */
export const toastAicoError = (
  error: unknown,
  t: LooseT,
  fallbackKey: string,
  options?: { phoneVerifyCallbackUrl?: string },
): void => {
  const raw = extractErrorCodeCandidate(error);
  const code = resolveAicoErrorCode(raw);
  const message = resolveAicoErrorMessage(error, t) ?? t(fallbackKey);

  if (code === 'PHONE_VERIFICATION_REQUIRED') {
    toast.error({
      actions: [
        {
          label: t('errors.verifyPhoneAction', { defaultValue: 'Verify phone' }),
          onClick: () => navigateToPhoneVerify(options?.phoneVerifyCallbackUrl),
          variant: 'primary',
        },
      ],
      duration: 12_000,
      title: message,
    });
    return;
  }

  toast.error(message);
};
