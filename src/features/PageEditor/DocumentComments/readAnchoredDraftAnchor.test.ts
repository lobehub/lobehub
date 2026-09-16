import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAnchoredScopeDraft,
  clearLegacyRootDraft,
  migrateDraftToAnchoredScope,
  preserveFailedAnchoredDraft,
  readAnchoredDraftAnchor,
  readLegacyRootDraft,
  readUnanchoredDraftFromAnchoredScope,
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

  it('still migrates once the anchored scope holds only an empty (cancelled or sent) draft', () => {
    // `submit` and `cancel` both clear their scope by writing a fresh empty
    // draft, not by removing the key — so the key's mere presence must not
    // be read as "has content of its own to protect".
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyDraft));
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ clientId: 'c2', content: '', editorData: null }),
    );

    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toEqual(legacyDraft);
  });

  it('returns null for an empty legacy draft (nothing worth migrating)', () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ clientId: 'c1', content: '', editorData: null }),
    );

    expect(readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('does not itself clear the legacy key — callers decide when the migrated copy is safe to drop', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyDraft));

    readLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID);

    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });
});

describe('clearLegacyRootDraft', () => {
  it('removes the legacy root-scope draft', () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ clientId: 'c1' }));

    clearLegacyRootDraft(WORKSPACE_ID, DOCUMENT_ID);

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe('readUnanchoredDraftFromAnchoredScope', () => {
  const inlineDraft = {
    clientId: 'c1',
    content: 'a plain comment started in AgentDocumentPage',
    editorData: null,
  };

  it('returns null when there is nothing under the anchored scope', () => {
    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('adopts an unanchored draft left under the anchored scope', () => {
    window.localStorage.setItem(KEY, JSON.stringify(inlineDraft));

    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toEqual(inlineDraft);
  });

  it('leaves a genuinely anchored draft alone — it belongs to the gutter, not the document-level composer', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ...inlineDraft, selectionAnchor: anchor }));

    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it("returns null once 'root' already has its own content to protect", () => {
    window.localStorage.setItem(KEY, JSON.stringify(inlineDraft));
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ clientId: 'c2', content: 'a fresh root draft', editorData: null }),
    );

    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('still adopts once root holds only an empty (cancelled or sent) draft', () => {
    window.localStorage.setItem(KEY, JSON.stringify(inlineDraft));
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({ clientId: 'c2', content: '', editorData: null }),
    );

    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toEqual(inlineDraft);
  });

  it('returns null for an empty anchored draft (nothing worth adopting)', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ clientId: 'c1', content: '', editorData: null }),
    );

    expect(readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID)).toBeNull();
  });

  it('does not itself clear the anchored key — callers decide when the adopted copy is safe to drop', () => {
    window.localStorage.setItem(KEY, JSON.stringify(inlineDraft));

    readUnanchoredDraftFromAnchoredScope(WORKSPACE_ID, DOCUMENT_ID);

    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });
});

describe('clearAnchoredScopeDraft', () => {
  it('removes the anchored-scope draft', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ clientId: 'c1' }));

    clearAnchoredScopeDraft(WORKSPACE_ID, DOCUMENT_ID);

    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('preserveFailedAnchoredDraft', () => {
  it('writes the failed draft under its own key, scoped by clientId', () => {
    const failed = {
      clientId: 'failed-1',
      content: 'a comment the reader typed while offline',
      editorData: null,
      selectionAnchor: anchor,
    };

    preserveFailedAnchoredDraft(WORKSPACE_ID, DOCUMENT_ID, failed);

    const raw = window.localStorage.getItem(
      `document-comment-draft:${WORKSPACE_ID}:${DOCUMENT_ID}:anchored-failed:failed-1`,
    );
    expect(raw && JSON.parse(raw)).toEqual(failed);
  });

  it('does not touch the shared anchored slot a newer draft may already own', () => {
    const newerDraft = { clientId: 'newer', content: 'the new draft', editorData: null };
    window.localStorage.setItem(KEY, JSON.stringify(newerDraft));

    preserveFailedAnchoredDraft(WORKSPACE_ID, DOCUMENT_ID, {
      clientId: 'failed-2',
      content: 'the failed draft',
      editorData: null,
    });

    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(newerDraft);
  });
});
