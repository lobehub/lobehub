import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearLegacyRootDraft,
  migrateDraftToAnchoredScope,
  readAnchoredDraftAnchor,
  readLegacyRootDraft,
} from './Composer';

const DOCUMENT_ID = 'doc-1';
const WORKSPACE_ID = 'ws-1';
const KEY = `document-comment-draft:${WORKSPACE_ID}:${DOCUMENT_ID}:anchored`;
const LEGACY_KEY = `document-comment-draft:${WORKSPACE_ID}:${DOCUMENT_ID}:root`;

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

describe('readLegacyRootDraft', () => {
  const legacyDraft = {
    clientId: 'c1',
    content: 'an unanchored draft from before',
    editorData: null,
  };

  it('returns null when there is no legacy draft', () => {
    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('returns a legacy plain-comment draft with no anchor', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyDraft));

    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toEqual(legacyDraft);
  });

  it('returns null once the new (anchored) scope already has its own draft', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyDraft));
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ clientId: 'c2', content: 'a fresh draft', editorData: null }),
    );

    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('returns null for an empty legacy draft (nothing worth migrating)', () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ clientId: 'c1', content: '', editorData: null }),
    );

    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });
});

describe('clearLegacyRootDraft', () => {
  it('removes the legacy root-scope draft', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ clientId: 'c1' }));

    clearLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID);

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
