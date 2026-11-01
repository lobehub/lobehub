import { describe, expect, it } from 'vitest';

import type { CheckProposal } from './proposal';
import { classifyProposalEdit } from './proposal';

const rect = (x: number, y: number) => ({ height: 0.1, width: 0.1, x, y });

const proposal = (
  overrides: Partial<Pick<CheckProposal, 'annotations' | 'comment'>> = {},
): Pick<CheckProposal, 'annotations' | 'comment'> => ({
  annotations: [{ comment: 'ring is too big', evidenceId: 'ev1', rect: rect(0.2, 0.2) }],
  comment: 'The progress ring is larger than the 20px the check asks for.',
  ...overrides,
});

describe('classifyProposalEdit', () => {
  it('reports verbatim when the reviewer submitted the proposal untouched', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: source.annotations!,
        comment: source.comment!,
      }),
    ).toBe('verbatim');
  });

  it('ignores whitespace-only differences in the comment', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: source.annotations!,
        comment: `  ${source.comment}  `,
      }),
    ).toBe('verbatim');
  });

  it('reports comment-edited when only the wording changed', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: source.annotations!,
        comment: 'Still too big — make it exactly 20px.',
      }),
    ).toBe('comment-edited');
  });

  it('reports region-moved when the reviewer relocated the box', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: [{ comment: 'ring is too big', evidenceId: 'ev1', rect: rect(0.6, 0.6) }],
        comment: source.comment!,
      }),
    ).toBe('region-moved');
  });

  it('treats a sub-half-percent nudge as the same region', () => {
    // A reviewer dragging a box by a pixel is not a grounding error; counting
    // it as one would report defects the model never made.
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: [{ comment: 'x', evidenceId: 'ev1', rect: rect(0.202, 0.203) }],
        comment: source.comment!,
      }),
    ).toBe('verbatim');
  });

  it('reports region-moved when the region was re-pinned to another frame', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: [{ comment: 'ring is too big', evidenceId: 'ev2', rect: rect(0.2, 0.2) }],
        comment: source.comment!,
      }),
    ).toBe('region-moved');
  });

  it('reports rewritten when every proposed region was dropped', () => {
    const source = proposal();
    expect(
      classifyProposalEdit(source, { annotations: [], comment: 'Completely different problem.' }),
    ).toBe('rewritten');
  });

  it('grades a region move above a comment edit when both changed', () => {
    // Wrong grounding is the more actionable defect for the next model
    // version, so it must not be masked by the comment also being reworded.
    const source = proposal();
    expect(
      classifyProposalEdit(source, {
        annotations: [{ comment: 'x', evidenceId: 'ev1', rect: rect(0.9, 0.9) }],
        comment: 'totally different words',
      }),
    ).toBe('region-moved');
  });

  it('does not report a move when several regions share one image', () => {
    // Regression: matching by evidenceId alone paired every proposed region
    // with the FIRST kept region on that image, so an untouched two-region
    // proposal — a layout defect and a text defect in the same screenshot —
    // reported region-moved and logged a grounding error that never happened.
    const twoRegions = {
      annotations: [
        { comment: 'card is off-centre', evidenceId: 'ev1', rect: rect(0.09, 0.18) },
        { comment: 'badge is unreadable', evidenceId: 'ev1', rect: rect(0.62, 0.03) },
      ],
      comment: 'two problems in this frame',
    };
    expect(
      classifyProposalEdit(twoRegions, {
        annotations: twoRegions.annotations,
        comment: twoRegions.comment,
      }),
    ).toBe('verbatim');
  });

  it('still reports a move when one of several shared-image regions is relocated', () => {
    const twoRegions = {
      annotations: [
        { comment: 'a', evidenceId: 'ev1', rect: rect(0.09, 0.18) },
        { comment: 'b', evidenceId: 'ev1', rect: rect(0.62, 0.03) },
      ],
      comment: 'c',
    };
    expect(
      classifyProposalEdit(twoRegions, {
        annotations: [
          { comment: 'a', evidenceId: 'ev1', rect: rect(0.09, 0.18) },
          { comment: 'b', evidenceId: 'ev1', rect: rect(0.8, 0.8) },
        ],
        comment: 'c',
      }),
    ).toBe('region-moved');
  });

  it('handles a proposal that carried no regions at all', () => {
    expect(
      classifyProposalEdit(
        { annotations: null, comment: 'something is off' },
        { annotations: [], comment: 'something is off' },
      ),
    ).toBe('verbatim');
  });
});
