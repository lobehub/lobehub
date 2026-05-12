import type { Idea } from '../types';
import type {
  CloseSelfReviewProposalInput,
  CreateSelfReviewProposalInput,
  RefreshSelfReviewProposalInput,
  SupersedeSelfReviewProposalInput,
  ToolSetFacade,
  ToolWriteResult,
} from './shared';

/** Adapter surface for review-only artifact writes. */
export interface ReviewToolsAdapters {
  /** Records a non-executable idea into the review output sink. */
  recordSelfReviewIdea?: (idea: Idea) => Promise<ToolWriteResult>;
}

/**
 * Review-mode tool facade for Daily Brief self-review output.
 *
 * Use when:
 * - Nightly self-review needs proposal lifecycle tools plus shared resource tools
 * - Review artifacts must stay separate from reflection receipts
 *
 * Expects:
 * - Shared tools are already scoped to the reviewed user and agent
 * - Proposal lifecycle writes are intentionally review-mode output
 *
 * Returns:
 * - A class surface with self-review naming for proposal and idea operations
 */
export class ReviewTools {
  constructor(
    private readonly shared: ToolSetFacade,
    private readonly adapters: ReviewToolsAdapters = {},
  ) {}

  createSelfReviewProposal(input: CreateSelfReviewProposalInput) {
    return this.shared.createSelfReviewProposal(input);
  }

  refreshSelfReviewProposal(input: RefreshSelfReviewProposalInput) {
    return this.shared.refreshSelfReviewProposal(input);
  }

  supersedeSelfReviewProposal(input: SupersedeSelfReviewProposalInput) {
    return this.shared.supersedeSelfReviewProposal(input);
  }

  closeSelfReviewProposal(input: CloseSelfReviewProposalInput) {
    return this.shared.closeSelfReviewProposal(input);
  }

  async recordSelfReviewIdea(idea: Idea): Promise<ToolWriteResult> {
    if (!this.adapters.recordSelfReviewIdea) {
      return {
        status: 'skipped_unsupported',
        summary: 'Self-review idea recording is not supported.',
      };
    }

    return this.adapters.recordSelfReviewIdea(idea);
  }
}
