import { useState } from 'react';

import { refreshSharedAgentStatus } from './useSharedAgent';

export interface BudgetStatusRetry {
  /** Whether a status-check attempt is currently in flight. */
  checkingBlock: boolean;
  /** Re-check the share's status (e.g. budget) — see the hook doc for details. */
  retryBlockedCheck: () => Promise<void>;
  /**
   * Set when the retry request itself failed (network/server error) — as
   * opposed to `blockedKey`, which reflects the share still being blocked.
   * Lets the caller tell those two apart in the UI.
   */
  retryCheckError: unknown;
}

/**
 * Re-check a share's visitor-facing status (currently just `budgetExhausted`)
 * without counting another page view, so a visitor blocked by an exhausted
 * budget can find out the owner topped up without reloading the whole page.
 *
 * The request itself can fail (transient network/server error). Earlier this
 * was launched with `void` from the click handler and never caught: a failed
 * retry just stopped the spinner while the stale "budget exhausted" copy
 * stayed on screen, and left an unhandled promise rejection behind. Catching
 * here lets the caller distinguish "still blocked" from "the retry itself
 * failed" and offer the visitor another attempt.
 */
export const useBudgetStatusRetry = (shareId: string, blockedKey?: string): BudgetStatusRetry => {
  const [checkingBlock, setCheckingBlock] = useState(false);
  const [retryCheckError, setRetryCheckError] = useState<unknown>();

  const retryBlockedCheck = async () => {
    if (!blockedKey || checkingBlock) return;
    setCheckingBlock(true);
    setRetryCheckError(undefined);
    try {
      await refreshSharedAgentStatus(shareId);
    } catch (error) {
      console.error('[AgentShareVisitor] budget status retry failed:', error);
      setRetryCheckError(error);
    } finally {
      setCheckingBlock(false);
    }
  };

  return { checkingBlock, retryBlockedCheck, retryCheckError };
};
