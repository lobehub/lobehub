import { describe, expect, it } from 'vitest';

import { buildEditPreview } from './buildEditPreview';

describe('buildEditPreview', () => {
  describe.each([false, true])('replace_all=%s', (replaceAll) => {
    it.each(['$$', '$&', '$`', "$'"])('previews replacement token %s literally', (replacement) => {
      const content = replaceAll ? 'before OLD middle OLD after' : 'before OLD after';
      const expected = replaceAll
        ? `before ${replacement} middle ${replacement} after`
        : `before ${replacement} after`;

      expect(
        buildEditPreview(content, {
          new_string: replacement,
          old_string: 'OLD',
          replace_all: replaceAll,
        }),
      ).toEqual({
        matchCount: replaceAll ? 2 : 1,
        newContent: expected,
        oldContent: content,
      });
    });
  });

  it('keeps ambiguous single replacements out of the approval diff', () => {
    const content = 'OLD middle OLD';

    expect(
      buildEditPreview(content, {
        new_string: '$&',
        old_string: 'OLD',
      }),
    ).toEqual({ matchCount: 2, newContent: content, oldContent: content });
  });
});
