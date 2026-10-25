import { beforeEach, describe, expect, it } from 'vitest';

import {
  evidenceCommentDraftKey,
  readEvidenceCommentDraft,
  saveEvidenceCommentDraft,
} from './evidenceCommentDraft';

const draft = {
  clientId: 'stable-retry-id',
  content: 'Check this image region',
  rect: { x: 0, y: 0, width: 1, height: 1 },
};

beforeEach(() => localStorage.clear());

describe('evidence comment drafts', () => {
  it('restores an image region, text and retry identity after reopening', () => {
    const key = evidenceCommentDraftKey('alice', 'delivery', 'image-1');
    saveEvidenceCommentDraft(key, draft);
    expect(readEvidenceCommentDraft(key)).toEqual(draft);
    expect(
      readEvidenceCommentDraft(evidenceCommentDraftKey('bob', 'delivery', 'image-1')),
    ).toBeUndefined();
    expect(
      readEvidenceCommentDraft(evidenceCommentDraftKey('alice', 'delivery', 'image-2')),
    ).toBeUndefined();
    saveEvidenceCommentDraft(key);
    expect(readEvidenceCommentDraft(key)).toBeUndefined();
  });

  it('ignores corrupt or invalid stored data', () => {
    localStorage.setItem('bad', '{');
    expect(readEvidenceCommentDraft('bad')).toBeUndefined();
    localStorage.setItem('bad', JSON.stringify({ ...draft, rect: { ...draft.rect, x: -1 } }));
    expect(readEvidenceCommentDraft('bad')).toBeUndefined();
  });
});
