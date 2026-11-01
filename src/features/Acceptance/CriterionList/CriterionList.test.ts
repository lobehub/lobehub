import { describe, expect, it, vi } from 'vitest';

import { hasLinkedInstruction } from './CriterionEditor';
import { rowKeyDownHandler } from './CriterionRow';

describe('rowKeyDownHandler', () => {
  it('ignores Enter/Space bubbling from a nested action control', () => {
    const onOpen = vi.fn();
    const row = {};
    const nestedControl = {};

    const handler = rowKeyDownHandler(onOpen);
    handler({ currentTarget: row, key: 'Enter', target: nestedControl });
    handler({ currentTarget: row, key: ' ', target: nestedControl });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('activates on Enter/Space originating from the row itself', () => {
    const onOpen = vi.fn();
    const row = {};

    const handler = rowKeyDownHandler(onOpen);
    handler({ currentTarget: row, key: 'Enter', target: row });
    handler({ currentTarget: row, key: ' ', target: row });
    handler({ currentTarget: row, key: 'a', target: row });

    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('hasLinkedInstruction', () => {
  it('is true for an existing criterion whose rule lives only in a linked document', () => {
    expect(hasLinkedInstruction({ documentId: 'doc_1' })).toBe(true);
  });

  it('is false when the draft carries an inline instruction or no linked document', () => {
    expect(hasLinkedInstruction({ documentId: 'doc_1', instruction: 'must be markdown' })).toBe(
      false,
    );
    expect(hasLinkedInstruction({})).toBe(false);
    expect(hasLinkedInstruction({ documentId: null })).toBe(false);
  });
});
