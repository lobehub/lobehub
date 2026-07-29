import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearPageDraft, readPageDraft } from './usePageDraft';

const KEY = 'page-draft:doc-1';

describe('usePageDraft — storage helpers', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('returns null when no draft is stored', () => {
    expect(readPageDraft('doc-1')).toBeNull();
  });

  it('round-trips a stored draft', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        documentId: 'doc-1',
        editorData: { type: 'doc', content: 'hello' },
        ownerId: 'owner-x',
        savedAt: new Date().toISOString(),
      }),
    );

    const draft = readPageDraft('doc-1');
    expect(draft).not.toBeNull();
    expect(draft?.documentId).toBe('doc-1');
    expect(draft?.editorData).toEqual({ type: 'doc', content: 'hello' });
    expect(draft?.ownerId).toBe('owner-x');
  });

  it('ignores drafts that name a different document', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        documentId: 'doc-2',
        editorData: null,
        savedAt: new Date().toISOString(),
      }),
    );

    expect(readPageDraft('doc-1')).toBeNull();
  });

  it('discards drafts older than 24h and clears them on read', () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        documentId: 'doc-1',
        editorData: { type: 'doc' },
        savedAt: stale,
      }),
    );

    expect(readPageDraft('doc-1')).toBeNull();
    // Cleaned up so the next open doesn't reprocess the same stale draft.
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clearPageDraft removes the stored draft', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        documentId: 'doc-1',
        editorData: null,
        savedAt: new Date().toISOString(),
      }),
    );

    clearPageDraft('doc-1');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns null on a corrupted draft payload', () => {
    window.sessionStorage.setItem(KEY, '{not-json');
    expect(readPageDraft('doc-1')).toBeNull();
  });
});
