import { describe, expect, it } from 'vitest';

import { buildHeterogeneousPrompt, HeterogeneousPromptEngine } from './promptEngine';

describe('HeterogeneousPromptEngine', () => {
  it('orders system context, provider context, user prompt, and images', () => {
    expect(
      buildHeterogeneousPrompt({
        imageList: [{ id: 'image-1', url: 'https://example.com/image.png' }],
        prompt: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
        systemContext: 'Workspace context',
      }),
    ).toEqual([
      { text: 'Workspace context', type: 'text' },
      {
        text: expect.stringContaining('`lh topic view <topic-id>`'),
        type: 'text',
      },
      {
        text: '<refer_topic name="Previous" id="topic-ref" />\nSummarize it',
        type: 'text',
      },
      {
        source: { id: 'image-1', type: 'url', url: 'https://example.com/image.png' },
        type: 'image',
      },
    ]);
  });

  it('does not add topic guidance to unrelated prompts', () => {
    expect(new HeterogeneousPromptEngine({ prompt: 'Hello' }).process()).toEqual([
      { text: 'Hello', type: 'text' },
    ]);
  });

  it('recognizes markdown-escaped topic tags', () => {
    const blocks = buildHeterogeneousPrompt({
      prompt: '\\<refer\\_topic name="Previous" id="topic-ref" />',
    });

    expect(blocks[0]).toEqual({
      text: expect.stringContaining('`lh topic view <topic-id>`'),
      type: 'text',
    });
  });
});
