import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it("should route the user's uploaded files here instead of Agent Documents", () => {
    expect(systemPrompt).toContain(
      'this Knowledge Base tool is the correct tool, not Agent Documents',
    );
  });

  it('should mandate listFiles before readKnowledge as the primary path for file requests', () => {
    expect(systemPrompt).toContain('Always use listFiles first');
    expect(systemPrompt).toContain(
      'it works regardless of whether the file has been organized into a knowledge base, and does not require the file to be pre-indexed',
    );
  });

  it('should scope searchKnowledgeBase to organized knowledge bases only, excluding the resource library', () => {
    expect(systemPrompt).toContain(
      'searchKnowledgeBase only covers files already organized into a knowledge base, not the general resource library',
    );
  });

  it('should order sandbox/CLI file listing as a last resort after listFiles and searchKnowledgeBase', () => {
    expect(systemPrompt).toContain(
      'Treat any sandbox/CLI file-listing command as a last-resort fallback only, after both listFiles and searchKnowledgeBase have been tried.',
    );
  });
});
