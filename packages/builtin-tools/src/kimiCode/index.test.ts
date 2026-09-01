import { describe, expect, it } from 'vitest';

import { countChangedLines, stripKimiLineNumbers } from './utils';

describe('Kimi Code tool surface normalization', () => {
  it('normalizes the numbered output emitted by Kimi Read', () => {
    expect(stripKimiLineNumbers('1\talpha\n  2\tbeta\nplain')).toBe('alpha\nbeta\nplain');
  });

  it('derives edit stats from Kimi old_string and new_string arguments', () => {
    expect(countChangedLines('old\nvalue', 'new')).toEqual({
      linesAdded: 1,
      linesDeleted: 2,
    });
    expect(countChangedLines('same', 'same')).toEqual({ linesAdded: 0, linesDeleted: 0 });
  });
});
