import { describe, expect, it } from 'vitest';

import { MERMAID_PREVIEW_HEIGHT } from './MermaidPreview';

describe('MermaidPreview height', () => {
  it('is large enough to prevent the mermaid diagram from overflowing its container', () => {
    expect(MERMAID_PREVIEW_HEIGHT).toBe(400);
  });

  it('is not the old value that caused the overflow regression', () => {
    expect(MERMAID_PREVIEW_HEIGHT).not.toBe(280);
  });
});
