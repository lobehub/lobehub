import type { ChatMessageError } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { isMemberBudgetExceeded } from './memberBudgetError';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
  message?: string;
}

export default function useBusinessErrorContent(
  error?: ChatMessageError | null,
): BusinessErrorContentResult {
  const { t } = useTranslation('error');

  if (isMemberBudgetExceeded(error)) return { message: t('memberBudgetExceeded') };

  return {};
}
