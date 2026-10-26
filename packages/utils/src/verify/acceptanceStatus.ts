import type { AcceptanceStatus } from '@lobechat/types';

// ============================================
// Status rollup — the aggregate's user-facing lifecycle state, derived from the
// current (highest) round. `accepted` is terminal and user-owned: recompute
// never overwrites it. `rejected` holds until a newer round re-opens the loop.
// ============================================

/** Derive the aggregate status from the current round's pipeline state. */
export const statusFromRound = (
  run: { status: string | null },
  hasReport: boolean,
): AcceptanceStatus => {
  switch (run.status) {
    case 'planned': {
      return 'planned';
    }
    case 'verifying': {
      return 'verifying';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'errored': {
      return 'errored';
    }
    // Both settled outcomes await the same human decision — the verdict is
    // advice, acceptance is the user's event (P-12).
    case 'passed':
    case 'failed':
    case 'delivered': {
      return 'delivered';
    }
    default: {
      // Ingested rounds carry no rollup status: a published report means the
      // round has settled and awaits the decision; otherwise it is still open.
      return hasReport ? 'delivered' : 'verifying';
    }
  }
};
