import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetEditorScrollTop,
  recallEditorScrollTop,
  rememberEditorScrollTop,
  resetEditorScrollMemory,
} from './editorScrollMemory';

describe('editorScrollMemory', () => {
  beforeEach(() => {
    resetEditorScrollMemory();
  });

  it('starts every document at the top', () => {
    expect(recallEditorScrollTop('doc-a')).toBe(0);
    expect(recallEditorScrollTop(undefined)).toBe(0);
  });

  it('remembers scroll offsets per document', () => {
    rememberEditorScrollTop('doc-a', 500);
    rememberEditorScrollTop('doc-b', 300);

    expect(recallEditorScrollTop('doc-a')).toBe(500);
    expect(recallEditorScrollTop('doc-b')).toBe(300);
    expect(recallEditorScrollTop('doc-c')).toBe(0);
  });

  it('overwrites the previous offset and clamps negatives', () => {
    rememberEditorScrollTop('doc-a', 500);
    rememberEditorScrollTop('doc-a', -20);

    expect(recallEditorScrollTop('doc-a')).toBe(0);
  });

  it('ignores writes without a document id', () => {
    rememberEditorScrollTop(undefined, 500);

    expect(recallEditorScrollTop(undefined)).toBe(0);
  });

  it('forgets a document on demand', () => {
    rememberEditorScrollTop('doc-a', 500);
    forgetEditorScrollTop('doc-a');

    expect(recallEditorScrollTop('doc-a')).toBe(0);
  });

  it('evicts the least recently remembered document past the cap', () => {
    for (let i = 0; i < 200; i++) rememberEditorScrollTop(`doc-${i}`, i + 1);
    // Touch doc-0 so it becomes the most recent entry.
    rememberEditorScrollTop('doc-0', 999);
    rememberEditorScrollTop('doc-new', 42);

    expect(recallEditorScrollTop('doc-0')).toBe(999);
    expect(recallEditorScrollTop('doc-1')).toBe(0);
    expect(recallEditorScrollTop('doc-new')).toBe(42);
  });
});
