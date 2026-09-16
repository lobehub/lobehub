import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { migrateDraftToAnchoredScope, readAnchoredDraftAnchor } from './Composer';

const DOCUMENT_ID = 'doc-1';
const WORKSPACE_ID = 'ws-1';
const KEY = `document-comment-draft:${WORKSPACE_ID}:${DOCUMENT_ID}:anchored`;

const anchor: DocumentCommentSelectionAnchor = { end: 12, quote: 'hello world', start: 0 };

beforeEach(() => {
  window.localStorage.clear();
});

describe('readAnchoredDraftAnchor', () => {
  it('returns undefined when no draft was persisted', () => {
    expect(readAnchoredDraftAnchor(WORKSPACE_ID, DOCUMENT_ID)).toBeUndefined();
  });

  it('returns the persisted anchor from the gutter draft', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        clientId: 'c1',
        content: 'draft text',
        editorData: null,
        selectionAnchor: anchor,
      }),
    );

    expect(readAnchoredDraftAnchor(WORKSPACE_ID, DOCUMENT_ID)).toEqual(anchor);
  });

  it('returns undefined for a draft with no captured selection', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ clientId: 'c1', content: 'draft text', editorData: null }),
    );

    expect(readAnchoredDraftAnchor(WORKSPACE_ID, DOCUMENT_ID)).toBeUndefined();
  });

  it('returns undefined for malformed JSON instead of throwing', () => {
    window.localStorage.setItem(KEY, '{not json');

    expect(readAnchoredDraftAnchor(WORKSPACE_ID, DOCUMENT_ID)).toBeUndefined();
  });

  it('falls back to the "personal" scope when there is no workspace', () => {
    window.localStorage.setItem(
      `document-comment-draft:personal:${DOCUMENT_ID}:anchored`,
      JSON.stringify({ clientId: 'c1', content: '', editorData: null, selectionAnchor: anchor }),
    );

    expect(readAnchoredDraftAnchor(undefined, DOCUMENT_ID)).toEqual(anchor);
  });
});

describe('migrateDraftToAnchoredScope', () => {
  it('moves the full draft — content and attachments included, not just the anchor', () => {
    const draft = {
      clientId: 'c1',
      content: 'a comment started before a gutter existed',
      editorData: { root: { children: [] } } as never,
      selectionAnchor: anchor,
    };

    migrateDraftToAnchoredScope(WORKSPACE_ID, DOCUMENT_ID, draft);

    const raw = window.localStorage.getItem(KEY);
    expect(raw && JSON.parse(raw)).toEqual(draft);
    expect(readAnchoredDraftAnchor(WORKSPACE_ID, DOCUMENT_ID)).toEqual(anchor);
  });
});
