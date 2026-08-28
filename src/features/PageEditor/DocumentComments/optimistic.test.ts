import type { DocumentCommentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  appendOptimisticReply,
  appendOptimisticThread,
  createOptimisticComment,
  flattenDocumentCommentReplies,
  isOptimisticDocumentComment,
  removeOptimisticReply,
  removeOptimisticThread,
  replaceOptimisticReply,
  replaceOptimisticThread,
  replaceReplyComment,
  replaceThreadComment,
  updateThreadReplyCount,
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
  updatedAt: createdAt,
  workspaceId: 'workspace-1',
});

describe('document comment optimistic cache', () => {
  it('marks only temporary client comments as optimistic', () => {
    expect(isOptimisticDocumentComment({ id: 'optimistic:pending' })).toBe(true);
    expect(isOptimisticDocumentComment({ id: 'dcm_server' })).toBe(false);
  });

  it('adds, reconciles, and rolls back a root comment without a refetch', () => {
    const optimistic = createOptimisticComment({
      author: createComment('author').author,
      clientId: 'pending-root',
      content: 'pending',
      documentId: 'document-1',
      editorData: null,
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const initial = [
      { items: [{ replyCount: 0, root: createComment('root-1') }], nextCursor: null },
    ];
    const inserted = appendOptimisticThread(initial, optimistic);

    expect(inserted[0].items.map(({ root }) => root.id)).toEqual([
      'root-1',
      'optimistic:pending-root',
    ]);

    const serverComment = { ...optimistic, canDelete: true, canEdit: true, id: 'root-2' };
    expect(replaceOptimisticThread(inserted, serverComment)?.[0].items.at(-1)?.root).toEqual(
      serverComment,
    );
    expect(removeOptimisticThread(inserted, optimistic.clientId)?.[0].items).toHaveLength(1);
  });

  it('keeps optimistic replies oldest-first across paginated data and maintains totals', () => {
    const first = createComment('reply-1', new Date('2026-01-01T00:00:01Z'));
    const second = createComment('reply-2', new Date('2026-01-01T00:00:02Z'));
    const optimistic = createComment('optimistic:pending', new Date('2026-01-01T00:00:03Z'));
    optimistic.clientId = 'pending-reply';
    const initial = [{ items: [first], nextCursor: 'next', total: 2 }];
    const inserted = appendOptimisticReply(initial, optimistic);
    const withNextPage = [...inserted, { items: [second], nextCursor: null }];

    expect(flattenDocumentCommentReplies(withNextPage).map(({ id }) => id)).toEqual([
      'reply-1',
      'reply-2',
      'optimistic:pending',
    ]);
    expect(inserted[0].total).toBe(3);

    const serverComment = { ...optimistic, id: 'reply-3' };
    expect(replaceOptimisticReply(inserted, serverComment)?.[0].items.at(-1)).toEqual(
      serverComment,
    );
    const rolledBack = removeOptimisticReply(inserted, optimistic.clientId);
    expect(rolledBack?.[0]).toMatchObject({ items: [first], total: 2 });
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
      flattenDocumentCommentReplies([
        { items: [first, second, child, grandchild, sibling], nextCursor: null },
      ]).map(({ id }) => id),
    ).toEqual(['reply-1', 'reply-1-child', 'reply-1-grandchild', 'reply-1-sibling', 'reply-2']);
  });

  it('updates a thread reply count without affecting other threads', () => {
    const pages = [
      {
        items: [
          { replyCount: 1, root: createComment('root-1') },
          { replyCount: 3, root: createComment('root-2') },
        ],
        nextCursor: null,
      },
    ];

    expect(updateThreadReplyCount(pages, 'root-1', 1)?.[0].items).toMatchObject([
      { replyCount: 2, root: { id: 'root-1' } },
      { replyCount: 3, root: { id: 'root-2' } },
    ]);
  });

  it('optimistically replaces root and reply content by their server ids', () => {
    const root = createComment('root-1');
    const reply = createComment('reply-1');
    const updatedRoot = { ...root, content: 'updated root' };
    const updatedReply = { ...reply, content: 'updated reply' };

    expect(
      replaceThreadComment(
        [{ items: [{ replyCount: 1, root }], nextCursor: null }],
        updatedRoot,
      )?.[0].items[0].root.content,
    ).toBe('updated root');
    expect(
      replaceReplyComment([{ items: [reply], nextCursor: null }], updatedReply)?.[0].items[0]
        .content,
    ).toBe('updated reply');
  });
});
