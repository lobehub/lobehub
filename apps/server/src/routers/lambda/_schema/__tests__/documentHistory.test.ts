import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_CONTENT_MAX_LENGTH,
  DOCUMENT_EDITOR_DATA_MAX_LENGTH,
  saveDocumentHistoryInputSchema,
  updateDocumentInputSchema,
} from '../documentHistory';

describe('document input size backstops', () => {
  it('rejects update content over the content cap', () => {
    const result = updateDocumentInputSchema.safeParse({
      content: 'x'.repeat(DOCUMENT_CONTENT_MAX_LENGTH + 1),
      id: 'doc-1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts update content at the cap', () => {
    const result = updateDocumentInputSchema.safeParse({
      content: 'x'.repeat(DOCUMENT_CONTENT_MAX_LENGTH),
      id: 'doc-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects update editorData over the editorData cap', () => {
    const result = updateDocumentInputSchema.safeParse({
      editorData: 'x'.repeat(DOCUMENT_EDITOR_DATA_MAX_LENGTH + 1),
      id: 'doc-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects history editorData over the editorData cap', () => {
    const result = saveDocumentHistoryInputSchema.safeParse({
      documentId: 'doc-1',
      editorData: 'x'.repeat(DOCUMENT_EDITOR_DATA_MAX_LENGTH + 1),
      saveSource: 'manual',
    });
    expect(result.success).toBe(false);
  });
});
