import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('should distinguish agent document ids from folder navigation ids', () => {
    expect(systemPrompt).toContain("For read and mutation calls, pass the result's `id`.");
    expect(systemPrompt).toContain(
      "For folder navigation, pass the folder's `documentId` (or the ID shown in a collapsed folder row) as `listDocuments.parentId`.",
    );
  });

  it("should route the user's uploaded files to the Knowledge Base tool when it is available", () => {
    expect(systemPrompt).toContain(
      'If the Knowledge Base tool is available in this conversation, use its listFiles/readKnowledge instead — do not treat listDocuments results as a match for an uploaded file.',
    );
  });

  it('should not dead-end when the Knowledge Base tool is unavailable', () => {
    expect(systemPrompt).toContain(
      "If the Knowledge Base tool is not available, listDocuments still cannot see the user's uploaded files",
    );
    expect(systemPrompt).toContain('do not simply refuse');
  });
});
