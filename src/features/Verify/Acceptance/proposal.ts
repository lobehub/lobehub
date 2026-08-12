import type {
  AcceptanceReviewAnnotation,
  ReviewPredictionAction,
  ReviewProposalEdit,
} from '@lobechat/types';

/**
 * The proposal shape the acceptance bundle hands the row. Structurally the
 * subset of `verify_review_predictions` the UI needs — kept local so the card
 * does not depend on the DB row type.
 */
export interface CheckProposal {
  /**
   * Always `reject`. Every attempt is stored, but an `accept` — like a skip or a
   * provider error — has nothing to ask the reviewer, so the read path only ever
   * hands this component the rejections.
   */
  action: Extract<ReviewPredictionAction, 'reject'>;
  annotations: AcceptanceReviewAnnotation[] | null;
  comment: string | null;
  confidence: number | null;
  id: string;
  model: string;
  provider: string;
  rationale: string | null;
}

const normalize = (value: string | null | undefined) => (value ?? '').trim();

/** Two regions are "the same region" when every edge is within half a percent
 *  of the image. Below that the reviewer nudged rather than relocated, and
 *  calling it a move would report grounding errors that never happened. */
const RECT_EPSILON = 0.005;

const sameRect = (a: AcceptanceReviewAnnotation['rect'], b: AcceptanceReviewAnnotation['rect']) =>
  Math.abs(a.x - b.x) < RECT_EPSILON &&
  Math.abs(a.y - b.y) < RECT_EPSILON &&
  Math.abs(a.width - b.width) < RECT_EPSILON &&
  Math.abs(a.height - b.height) < RECT_EPSILON;

/**
 * How far the reviewer's submitted reject drifted from the proposal it started
 * from.
 *
 * This is the whole reason the confirm path opens a prefilled modal instead of
 * writing the proposal straight through: the reviewer was going to author this
 * reject anyway, and the diff between what was proposed and what was submitted
 * separates "the model was right" from "the model was right about there being a
 * problem, but pointed at the wrong pixels" — which no single button could.
 *
 * Ordering matters: a moved region outranks an edited comment, because wrong
 * grounding is the more actionable defect for the next model version.
 */
export const classifyProposalEdit = (
  proposal: Pick<CheckProposal, 'annotations' | 'comment'>,
  submitted: { annotations?: AcceptanceReviewAnnotation[]; comment?: string },
): ReviewProposalEdit => {
  const proposed = proposal.annotations ?? [];
  const kept = submitted.annotations ?? [];

  // Dropping every proposed region (while still rejecting) means the reviewer
  // rebuilt the case from scratch.
  if (proposed.length > 0 && kept.length === 0) return 'rewritten';

  // Match each proposed region against ANY surviving region on the same image,
  // not the first one found there. Several regions routinely share one
  // screenshot (a layout defect and a text defect in the same frame), and
  // keying on `evidenceId` alone matched every one of them to region #1 — so an
  // untouched two-region proposal reported a move that never happened, feeding
  // a false grounding error into the training signal.
  const moved = proposed.some(
    (original) =>
      !kept.some(
        (region) =>
          region.evidenceId === original.evidenceId && sameRect(region.rect, original.rect),
      ),
  );
  if (moved) return 'region-moved';

  if (normalize(submitted.comment) !== normalize(proposal.comment)) return 'comment-edited';

  return 'verbatim';
};

/**
 * Seed the reject modal from a proposal: the model's note becomes the draft
 * comment, its regions become editable annotations.
 */
export const proposalToRejectDraft = (proposal: CheckProposal) => ({
  annotations: proposal.annotations ?? [],
  comment: proposal.comment ?? '',
});
