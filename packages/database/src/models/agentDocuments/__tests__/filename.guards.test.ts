import { describe, expect, it } from 'vitest';

import { extractMarkdownH1Title } from '../filename';

describe('extractMarkdownH1Title guards', () => {
  it('returns blank-only content unchanged', () => {
    expect(extractMarkdownH1Title('\n  \n\t')).toEqual({ content: '\n  \n\t' });
    expect(extractMarkdownH1Title('')).toEqual({ content: '' });
  });
});
