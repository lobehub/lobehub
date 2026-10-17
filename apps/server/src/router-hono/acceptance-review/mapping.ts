import type { AcceptanceCommentItem, ReviewComment } from '@lobechat/types';

const MAX_THREADS = 200;

interface Viewer {
  userId: string;
}

export const toReviewComment = (item: AcceptanceCommentItem, viewer: Viewer): ReviewComment => {
  const mine = item.authorUserId === viewer.userId;
  const screenshot = item.attachments[0]?.url;
  return {
    anchor: item.source,
    author: {
      avatar: item.author.avatar ?? undefined,
      id: item.author.id ?? '',
      name: item.author.fullName || item.author.username || '',
    },
    clientId: item.clientId,
    content: item.content,
    createdAt: item.createdAt.toISOString(),
    id: item.id,
    mine,
    parentId: item.parentCommentId,
    replies: [],
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    round: item.contextRoundIndex,
    screenshot: screenshot ? { url: screenshot } : null,
  };
};

export const toReviewThreads = (items: AcceptanceCommentItem[], viewer: Viewer) => {
  const visible = items.filter((item) => item.kind === 'comment' && !item.deletedAt);
  const replies = new Map<string, ReviewComment[]>();
  for (const item of visible) {
    if (!item.parentCommentId) continue;
    const thread = replies.get(item.parentCommentId) ?? [];
    thread.push(toReviewComment(item, viewer));
    replies.set(item.parentCommentId, thread);
  }
  return visible
    .filter((item) => !item.parentCommentId)
    .slice(-MAX_THREADS)
    .reverse()
    .map((root) => ({ ...toReviewComment(root, viewer), replies: replies.get(root.id) ?? [] }));
};
