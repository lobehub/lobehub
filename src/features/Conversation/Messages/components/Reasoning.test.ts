import { describe, expect, it } from 'vitest';

import { hasRenderableReasoning } from './Reasoning';

describe('hasRenderableReasoning', () => {
  it('is false for signature-only reasoning', () => {
    expect(hasRenderableReasoning({ signature: '395a9e64-8cfb' })).toBe(false);
  });

  it('is false for missing or whitespace-only content', () => {
    expect(hasRenderableReasoning(undefined)).toBe(false);
    expect(hasRenderableReasoning({})).toBe(false);
    expect(hasRenderableReasoning({ content: '   ' })).toBe(false);
  });

  it('is true for non-blank content', () => {
    expect(hasRenderableReasoning({ content: 'let me think', signature: 'sig' })).toBe(true);
  });

  it('is true for multimodal tempDisplayContent without content', () => {
    expect(
      hasRenderableReasoning({
        isMultimodal: true,
        tempDisplayContent: [{ image: 'data:image/png;base64,b64', type: 'image' }],
      }),
    ).toBe(true);
  });
});
