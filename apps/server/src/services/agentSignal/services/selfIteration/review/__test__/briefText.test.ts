// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createSelfReviewBriefText } from '../briefText';

describe('agent signal self-review brief text', () => {
  /**
   * @example
   * Proposal outcomes produce default English decision text with action details.
   */
  it('renders default English proposal text with proposal details', () => {
    expect(
      createSelfReviewBriefText({
        actionCounts: { applied: 0, failed: 0, proposed: 2, skipped: 1 },
        actionSummaries: {
          applied: [],
          failed: [],
          proposed: ['Review skill consolidation proposal.', 'Review PR checklist refinement.'],
        },
        outcome: 'proposal',
      }),
    ).toEqual({
      priority: 'normal',
      summary:
        '2 dream suggestions need your review.\n\n**Suggestion**\n- Review skill consolidation proposal.\n- Review PR checklist refinement.',
      title: 'Dream suggestion needs review',
      type: 'decision',
    });
  });

  /**
   * @example
   * Applied outcomes render source-English insight text.
   */
  it('renders applied text in source English', () => {
    expect(
      createSelfReviewBriefText({
        actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
        actionSummaries: {
          applied: ['Saved concise PR summary preference.'],
          failed: [],
          proposed: [],
        },
        outcome: 'applied',
      }).title,
    ).toBe('Dream updated resources');
  });
});
