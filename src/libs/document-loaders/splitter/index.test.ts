import { describe, expect, it } from 'vitest';

import { splitText } from './index';

describe('document splitter chunk budget', () => {
  it('aborts while splitting once the chunk budget is exhausted', () => {
    expect(() =>
      splitText('abcdef', {
        chunkOverlap: 0,
        chunkSize: 1,
        maxChunks: 3,
      }),
    ).toThrow('Document chunk count exceeds maximum allowed limit of 3');
  });
});
