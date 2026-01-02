import { describe, expect, it } from 'vitest';

import rehypePlugin from './rehypePlugin';

describe('rehypePlugin', () => {
  it('should transform <lobeArtifact> tags with attributes', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [
            {
              type: 'raw',
              value: '<lobeArtifact identifier="test-id" type="image/svg+xml" title="Test Title">',
            },
            { type: 'text', value: 'Artifact content' },
            { type: 'raw', value: '</lobeArtifact>' },
          ],
        },
      ],
    };

    const expectedTree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'lobeArtifact',
          properties: {
            identifier: 'test-id',
            type: 'image/svg+xml',
            title: 'Test Title',
          },
          children: [{ type: 'text', value: 'Artifact content' }],
        },
      ],
    };

    const plugin = rehypePlugin();
    plugin(tree);

    expect(tree).toEqual(expectedTree);
  });

  it('should handle mixed content with thinking tags and plain text', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'Initial plain text paragraph' }],
        },
        {
          type: 'element',
          tagName: 'p',
          children: [
            { type: 'raw', value: '<lobeThinking>' },
            { type: 'text', value: 'AI is thinking...' },
            { type: 'raw', value: '</lobeThinking>' },
          ],
        },
        {
          type: 'element',
          tagName: 'p',
          children: [
            {
              type: 'raw',
              value: '<lobeArtifact identifier="test-id" type="image/svg+xml" title="Test Title">',
            },
            { type: 'text', value: 'Artifact content' },
            { type: 'raw', value: '</lobeArtifact>' },
          ],
        },
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'Final plain text paragraph' }],
        },
      ],
    };

    const expectedTree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'Initial plain text paragraph' }],
        },
        {
          type: 'element',
          tagName: 'p',
          children: [
            { type: 'raw', value: '<lobeThinking>' },
            { type: 'text', value: 'AI is thinking...' },
            { type: 'raw', value: '</lobeThinking>' },
          ],
        },
        {
          type: 'element',
          tagName: 'lobeArtifact',
          properties: {
            identifier: 'test-id',
            type: 'image/svg+xml',
            title: 'Test Title',
          },
          children: [{ type: 'text', value: 'Artifact content' }],
        },
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'Final plain text paragraph' }],
        },
      ],
    };

    const plugin = rehypePlugin();
    plugin(tree);

    expect(tree).toEqual(expectedTree);
  });
});
