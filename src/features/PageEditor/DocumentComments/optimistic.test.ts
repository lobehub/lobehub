import type { DocumentCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  flattenDocumentCommentReplies,
  flattenDocumentCommentThreads,
  isOptimisticDocumentComment,
} from './optimistic';

const createComment = (
  id: string,
  createdAt: Date = new Date('2026-01-01T00:00:00Z'),
): DocumentCommentItem => ({
  author: {
    avatar: null,
    fullName: 'Lin',
    id: 'user-1',
    status: 'active',
    username: 'lin',
  },
  authorUserId: 'user-1',
  canDelete: true,
  canEdit: true,
  clientId: `client-${id}`,
  content: id,
  createdAt,
  deletedAt: null,
  documentId: 'document-1',
  editorData: null,
  id,
  parentCommentId: null,
  replyTo: null,
  replyToCommentId: null,
  selectionAnchor: null,
  updatedAt: createdAt,
  workspaceId: 'workspace-1',
});

describe('document comment optimistic cache', () => {
  it('marks only temporary client comments as optimistic', () => {
    expect(isOptimisticDocumentComment({ id: 'optimistic:pending' })).toBe(true);
    expect(isOptimisticDocumentComment({ id: 'dcm_server' })).toBe(false);
  });

  it('keeps replies oldest-first, an optimistic one last', () => {
    const first = createComment('reply-1', new Date('2026-01-01T00:00:01Z'));
    const second = createComment('reply-2', new Date('2026-01-01T00:00:02Z'));
    const optimistic = createComment('optimistic:pending', new Date('2026-01-01T00:00:03Z'));

    expect(flattenDocumentCommentReplies([second, optimistic, first]).map(({ id }) => id)).toEqual([
      'reply-1',
      'reply-2',
      'optimistic:pending',
    ]);
  });

  it('sorts roots oldest-first and drops duplicate rows', () => {
    const older = createComment('root-1', new Date('2026-01-01T00:00:01Z'));
    const newer = createComment('root-2', new Date('2026-01-01T00:00:02Z'));

    expect(
      flattenDocumentCommentThreads([
        { replyCount: 0, root: newer },
        { replyCount: 0, root: older },
        { replyCount: 1, root: newer },
      ]).map(({ replyCount, root }) => [root.id, replyCount]),
    ).toEqual([
      ['root-1', 0],
      ['root-2', 1],
    ]);
  });

  it('places replies to replies next to their target while keeping a single flat list', () => {
    const first = createComment('reply-1', new Date('2026-01-01T00:00:01Z'));
    const second = createComment('reply-2', new Date('2026-01-01T00:00:02Z'));
    const child = {
      ...createComment('reply-1-child', new Date('2026-01-01T00:00:03Z')),
      replyToCommentId: first.id,
    };
    const grandchild = {
      ...createComment('reply-1-grandchild', new Date('2026-01-01T00:00:04Z')),
      replyToCommentId: child.id,
    };
    const sibling = {
      ...createComment('reply-1-sibling', new Date('2026-01-01T00:00:05Z')),
      replyToCommentId: first.id,
    };

    expect(
      flattenDocumentCommentReplies([first, second, child, grandchild, sibling]).map(
        ({ id }) => id,
      ),
    ).toEqual(['reply-1', 'reply-1-child', 'reply-1-grandchild', 'reply-1-sibling', 'reply-2']);
  });
});
