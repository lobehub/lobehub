import { describe, expect, it } from 'vitest';

import { getDocumentOnlyHits } from './getDocumentOnlyHits';

const document = (documentId: string, fileId?: string) => ({
  documentId,
  fileId,
  knowledgeBaseId: 'kb',
  relevance: 2,
  snippet: 'matched passage',
  title: documentId,
  updatedAt: '2026-11-08',
});

describe('getDocumentOnlyHits', () => {
  it('lists full-text hits when the vector path returned nothing', () => {
    expect(
      getDocumentOnlyHits({ documents: [document('doc-1', 'file-1')], fileResults: [] }),
    ).toEqual([document('doc-1', 'file-1')]);
  });

  it('drops a hit whose file is already listed from vector search', () => {
    const hits = getDocumentOnlyHits({
      documents: [document('doc-1', 'file-1'), document('doc-2')],
      fileResults: [{ fileId: 'file-1', fileName: 'a.md', relevanceScore: 0.9, topChunks: [] }],
    });

    expect(hits.map(({ documentId }) => documentId)).toEqual(['doc-2']);
  });

  it('returns nothing for a payload without documents', () => {
    expect(getDocumentOnlyHits()).toEqual([]);
    expect(getDocumentOnlyHits({ fileResults: [] })).toEqual([]);
  });
});
