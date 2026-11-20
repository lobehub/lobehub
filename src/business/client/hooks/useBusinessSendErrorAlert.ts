import type { ReactNode } from 'react';

export interface BusinessSendErrorAlert {
  /** Button shown beside the notice, such as an upgrade entry. */
  action?: ReactNode;
  /** Replaces the line under the title, so it names only the actions offered. */
  description?: string;
  /** Replaces the default notice text. */
  title?: string;
}

/**
 * Lets a deployment enrich the composer notice for a refused send, keyed by the
 * error type the server returned as the message. `onClose` dismisses the notice,
 * for an action that already resolved the refusal.
 */
export const useBusinessSendErrorAlert = (
  _errorMessage?: string,
  _onClose?: () => void,
): BusinessSendErrorAlert => ({});
