'use client';

import { memo } from 'react';

import { AcceptanceCheckRow } from '../Checks/CheckRow';
import type { AcceptanceCheck, CheckReviewInput, ProposalDismissInput } from '../Checks/types';

interface FocusedCheckDetailsProps {
  canReview: boolean;
  check: AcceptanceCheck;
  /** Answer a model proposal without ruling on the check itself. */
  onDismissProposal?: (input: ProposalDismissInput) => Promise<void>;
  /** Open an agent judge's verification run (its trace IS the argument). */
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound?: (round: number) => void;
  reviewPending: boolean;
}

/** Full check content for the dedicated second-level acceptance workspace. */
export const FocusedCheckDetails = memo<FocusedCheckDetailsProps>(
  ({ canReview, check, onDismissProposal, onOpenTrace, onReview, onRound, reviewPending }) => (
    <AcceptanceCheckRow
      detailMode
      expanded
      canReview={canReview}
      check={check}
      reviewPending={reviewPending}
      onDismissProposal={onDismissProposal}
      onOpenTrace={onOpenTrace}
      onReview={onReview}
      onRound={onRound}
      onToggle={() => {}}
    />
  ),
);

FocusedCheckDetails.displayName = 'FocusedCheckDetails';
