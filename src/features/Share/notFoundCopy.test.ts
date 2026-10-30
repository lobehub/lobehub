import { describe, expect, it } from 'vitest';

import { resolveShareNotFoundCopy } from './notFoundCopy';

const topicCopy = { desc: 'This topic does not exist.', title: 'Topic Not Found' };

describe('resolveShareNotFoundCopy', () => {
  it('keeps the topic wording by default', () => {
    expect(resolveShareNotFoundCopy(undefined, topicCopy)).toBe(topicCopy);
  });

  // Regression: a broken file share link reported "Topic Not Found".
  it("uses the page's own wording when it names one", () => {
    const fileCopy = { desc: 'This file does not exist.', title: 'File Not Found' };
    expect(resolveShareNotFoundCopy(fileCopy, topicCopy)).toBe(fileCopy);
  });
});
