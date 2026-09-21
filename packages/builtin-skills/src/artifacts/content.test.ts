import { describe, expect, it } from 'vitest';

import { systemPrompt } from './content';

describe('artifacts system prompt', () => {
  it('uses matching artifacts guide boundary tags', () => {
    expect(systemPrompt).toMatch(/^<artifacts_guides>/);
    expect(systemPrompt).toMatch(/<\/artifacts_guides>\s*$/);
  });
});
