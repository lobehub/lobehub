import { describe, expect, it } from 'vitest';

import { sanitizeInboxPreview } from './sanitizeInboxPreview';

describe('sanitizeInboxPreview', () => {
  it('removes closed thinking blocks while preserving the answer', () => {
    expect(sanitizeInboxPreview('<think>private reasoning</think>\nFinal answer')).toBe(
      'Final answer',
    );
  });

  it('removes an unfinished thinking block from a truncated preview', () => {
    expect(sanitizeInboxPreview('Visible answer\n<think>unfinished reasoning')).toBe(
      'Visible answer',
    );
  });

  it('removes orphan thinking tags without dropping surrounding content', () => {
    expect(sanitizeInboxPreview('Before </think> after')).toBe('Before  after');
  });

  it('leaves ordinary Markdown and acceptance links intact', () => {
    const content = 'Done: [view acceptance](/acceptance/a-1)';

    expect(sanitizeInboxPreview(content)).toBe(content);
  });
});
