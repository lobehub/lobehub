import { documentBlocksPrompt } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('should distinguish agent document ids from folder navigation ids', () => {
    expect(systemPrompt).toContain("For read and mutation calls, pass the result's `id`.");
    expect(systemPrompt).toContain(
      "For folder navigation, pass the folder's `documentId` (or the ID shown in a collapsed folder row) as `listDocuments.parentId`; the same works for a document that has nested docs.",
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

  it('should route document organization to folder APIs instead of a CLI', () => {
    expect(systemPrompt).toContain('8. Create folder (createFolder)');
    expect(systemPrompt).toContain('9. Move documents (moveDocuments)');
    expect(systemPrompt).toContain('Do not fall back to a CLI or sandbox for this.');
    expect(systemPrompt).toContain('createDocument(parentId=…) instead of the root');
  });

  it('should make documents the default parent for records produced by following them', () => {
    expect(systemPrompt).toContain('A **document** can be a parent.');
    expect(systemPrompt).toContain('a workflow/SOP document with its execution records');
    expect(systemPrompt).toContain('removeDocument refuses an entry that has children');
  });

  it('should tell the agent which rich blocks documents support', () => {
    expect(systemPrompt).toContain(documentBlocksPrompt);
  });
});
