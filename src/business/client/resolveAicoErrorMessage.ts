import {
  AICO_ERROR_MESSAGES_FA,
  type AicoErrorCode,
  resolveAicoErrorCode,
} from '@lobechat/business-const';

import { message } from '@/components/AntdStaticMethods';

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

/** Toast a known Aico code, otherwise the caller's fallback key. */
export const toastAicoError = (error: unknown, t: LooseT, fallbackKey: string): void => {
  message.error(resolveAicoErrorMessage(error, t) ?? t(fallbackKey));
};
