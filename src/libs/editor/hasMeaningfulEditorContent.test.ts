import { describe, expect, it } from 'vitest';

import { hasMeaningfulEditorContent } from './hasMeaningfulEditorContent';

describe('hasMeaningfulEditorContent', () => {
  it('should reject an empty paragraph editor state', () => {
    expect(
      hasMeaningfulEditorContent({
        root: {
          children: [
            {
              children: [],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      }),
    ).toBe(false);
  });

  it('should accept text content', () => {
    expect(
      hasMeaningfulEditorContent({
        root: {
          children: [
            {
              children: [{ text: 'content', type: 'text' }],
              type: 'paragraph',
            },
          ],
          type: 'root',
        },
      }),
    ).toBe(true);
  });

  it('should accept non-text structural content', () => {
    expect(
      hasMeaningfulEditorContent({
        root: {
          children: [{ type: 'horizontalrule' }],
          type: 'root',
        },
      }),
    ).toBe(true);
  });
});
