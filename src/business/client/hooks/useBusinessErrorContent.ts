import type { ChatMessageError } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { resolveAicoErrorMessage } from '@/business/client/resolveAicoErrorMessage';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
  message?: string;
}

export default function useBusinessErrorContent(
  error?: ChatMessageError | null,
): BusinessErrorContentResult {
  const { t } = useTranslation('aico');
  const message = resolveAicoErrorMessage(error?.message, t);
  if (!message) return {};
  return { message };
}
