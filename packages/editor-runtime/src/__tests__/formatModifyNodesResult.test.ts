import { describe, expect, it } from 'vitest';

import { formatModifyNodesResult, PENDING_REVIEW_NOTE } from '../formatModifyNodesResult';

describe('formatModifyNodesResult', () => {
  it('summarises a fully applied batch', () => {
    expect(
      formatModifyNodesResult({
        results: [
          { action: 'insert', success: true },
          { action: 'insert', success: true },
        ],
        successCount: 2,
        totalCount: 2,
      }),
    ).toBe('Successfully executed 2 inserts (2/2 operations succeeded).');
  });

  it('does not report a partially applied batch as a success', () => {
    const content = formatModifyNodesResult({
      results: [
        { action: 'modify', error: 'node "zzzz" not found in the document', success: false },
        { action: 'insert', success: true },
      ],
      successCount: 1,
      totalCount: 2,
    });

    expect(content).not.toContain('Successfully');
    expect(content).toMatchInlineSnapshot(`
      "Only 1/2 operations succeeded (1 modify, 1 insert requested). Failed operations were not applied:
      - Operation 1 (modify): node "zzzz" not found in the document
      Call getPageContent to get the current node ids before retrying the failed operations."
    `);
  });

  it('flags an operation that failed after part of it was applied', () => {
    const content = formatModifyNodesResult({
      results: [
        {
          action: 'modify',
          error: 'node "zzzz" not found in the document',
          partiallyApplied: true,
          success: false,
        },
      ],
      successCount: 0,
      totalCount: 1,
    });

    expect(content).toContain('except those marked PARTIALLY APPLIED');
    expect(content).toContain('- Operation 1 (modify): PARTIALLY APPLIED');
  });

  it('says the edits are not live when the editor keeps them as review diffs', () => {
    const content = formatModifyNodesResult(
      {
        results: [{ action: 'insert', pendingReview: true, success: true }],
        successCount: 1,
        totalCount: 1,
      },
      { pendingReview: true },
    );

    expect(content).toContain('Successfully executed 1 insert');
    expect(content).toContain(PENDING_REVIEW_NOTE);
  });

  it('stays silent about review diffs when every operation failed', () => {
    const content = formatModifyNodesResult(
      {
        results: [{ action: 'remove', error: 'node "zzzz" not found', success: false }],
        successCount: 0,
        totalCount: 1,
      },
      { pendingReview: true },
    );

    expect(content).not.toContain(PENDING_REVIEW_NOTE);
  });

  it('does not claim a review diff for operations the editor applied directly', () => {
    const content = formatModifyNodesResult(
      {
        // list edits bypass the review diff and are live immediately
        results: [{ action: 'insert', pendingReview: false, success: true }],
        successCount: 1,
        totalCount: 1,
      },
      { pendingReview: true },
    );

    expect(content).toBe('Successfully executed 1 insert (1/1 operations succeeded).');
  });

  it('separates the operations that are diffs from the ones already written', () => {
    const content = formatModifyNodesResult(
      {
        results: [
          { action: 'modify', pendingReview: true, success: true },
          { action: 'insert', pendingReview: false, success: true },
        ],
        successCount: 2,
        totalCount: 2,
      },
      { pendingReview: true },
    );

    expect(content).toContain('1 of 2 applied operations are review diffs and are NOT live yet');
    expect(content).toContain(PENDING_REVIEW_NOTE);
  });

  it('keeps a partial operation that left a diff in the pending count', () => {
    const content = formatModifyNodesResult(
      {
        results: [
          {
            action: 'modify',
            error: 'node "zzzz" not found in the document',
            partiallyApplied: true,
            pendingReview: true,
            success: false,
          },
        ],
        successCount: 0,
        totalCount: 1,
      },
      { pendingReview: true },
    );

    expect(content).toContain('1 of 1 operations are review diffs');
    expect(content).toContain('failed after part of it was written');
    expect(content).toContain(PENDING_REVIEW_NOTE);
  });

  it('keeps the previous wording when the host applies edits directly', () => {
    const content = formatModifyNodesResult({
      results: [{ action: 'insert', success: true }],
      successCount: 1,
      totalCount: 1,
    });

    expect(content).not.toContain('review diff');
  });
});
