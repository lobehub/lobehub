import { useTranslation } from 'react-i18next';

import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

import { formatErrorReason } from './verdict';

const ERROR_CODE = /^[A-Z][\dA-Za-z]+$/;

export interface CaseErrorReason {
  /** Machine code (e.g. `InvalidProviderAPIKey`), shown beside the sentence when it adds info. */
  code?: string;
  message: string;
}

/**
 * A case error as a person reads it: runtime error codes become the same
 * localized sentence chat shows for them; anything else is unwrapped text.
 */
export const useCaseErrorReason = (
  evalResult?: { error?: unknown; errorDetail?: unknown } | null,
  provider?: string | null,
): CaseErrorReason | undefined => {
  const { t } = useTranslation(['error', 'modelRuntime']);
  const raw = formatErrorReason(evalResult?.error);
  if (!raw) return;

  const detail = evalResult?.errorDetail as { errorType?: string; type?: string } | undefined;
  const code = detail?.type || detail?.errorType || (ERROR_CODE.test(raw) ? raw : undefined);
  if (!code) return { message: raw };

  const message = getRuntimeErrorMessage(t, code, { provider: provider || 'Provider' }, raw);
  return message === code ? { message } : { code, message };
};
