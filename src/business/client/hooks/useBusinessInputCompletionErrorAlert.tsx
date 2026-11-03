import type { ReactNode } from 'react';

import type { InputCompletionError } from '@/features/ChatInput/store/initialState';

export interface BusinessInputCompletionErrorAlertParams {
  error?: InputCompletionError;
  onRetry: () => void;
}

export interface BusinessInputCompletionErrorAlertResult {
  action?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
}

export const useBusinessInputCompletionErrorAlert = (
  _params: BusinessInputCompletionErrorAlertParams,
): BusinessInputCompletionErrorAlertResult => ({});
