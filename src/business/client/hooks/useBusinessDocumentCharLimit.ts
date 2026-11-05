import type { ReactNode } from 'react';

export interface BusinessDocumentCharLimit {
  /** Button shown beside the page-limit notice, such as an upgrade entry. */
  action?: ReactNode;
  /** Per-page character limit known before a save is refused. Undefined means unknown or unlimited. */
  limit?: number;
}

/**
 * Lets a deployment tell the page editor the character limit that applies to
 * the current user, so it can warn before a save is refused.
 */
export const useBusinessDocumentCharLimit = (): BusinessDocumentCharLimit => ({
  action: undefined,
  limit: undefined,
});
