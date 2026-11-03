import type {
  AcceptanceRejectIntent,
  AcceptanceReviewAnnotation,
  ReviewAdjudication,
  ReviewProposalEdit,
} from '@lobechat/types';

import type { AcceptanceBundle } from '@/services/verify';

export type AcceptanceCheck = AcceptanceBundle['checks'][number];
export type AcceptanceCheckState = AcceptanceCheck['state'];
export type AcceptanceEvidence = AcceptanceCheck['evidence'][number];
export type AcceptanceCheckReviewEntry = AcceptanceCheck['reviews'][number];

export interface CheckReviewInput {
  action: 'accept' | 'ignore' | 'reject';
  annotations?: AcceptanceReviewAnnotation[];
  checkItemIds: string[];
  comment?: string;
  fileIds?: string[];
  /** Present when this decision answered a model proposal. */
  proposal?: { adjudication: ReviewAdjudication; edit?: ReviewProposalEdit; predictionId: string };
  /** Which of the three jobs a reject is doing. */
  rejectIntent?: AcceptanceRejectIntent;
}

/** Answering a model proposal without ruling on the check. */
export interface ProposalDismissInput {
  adjudication: 'misidentified' | 'not-an-issue';
  checkItemId: string;
  predictionId: string;
}
