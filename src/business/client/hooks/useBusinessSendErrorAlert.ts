import type { ReactNode } from 'react';

export interface BusinessSendErrorAlert {
  /** Button shown beside the notice, such as an upgrade entry. */
  action?: ReactNode;
  /** Replaces the default notice text. */
  title?: string;
}

/**
 * Lets a deployment enrich the composer notice for a refused send, keyed by the
 * error type the server returned as the message.
 */
export const useBusinessSendErrorAlert = (_errorMessage?: string): BusinessSendErrorAlert => ({});
