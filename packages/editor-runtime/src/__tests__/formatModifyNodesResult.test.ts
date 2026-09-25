import { describe, expect, it } from 'vitest';

import { formatModifyNodesResult } from '../formatModifyNodesResult';

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
});
