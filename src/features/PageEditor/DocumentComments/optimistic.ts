import type {
  DocumentCommentAuthor,
  DocumentCommentItem,
  DocumentCommentJson,
  DocumentCommentReplyPage,
  DocumentCommentThreadPage,
} from '@lobechat/types';

interface CreateOptimisticCommentParams {
  author: DocumentCommentAuthor;
  clientId: string;
  content: string;
  documentId: string;
  editorData: DocumentCommentJson | null;
  parentCommentId?: string;
  replyTo?: DocumentCommentItem['replyTo'];
  userId: string | null;
  workspaceId: string;
}

export interface DocumentCommentSubmitInput {
  clientId: string;
  content: string;
  editorData: DocumentCommentJson;
}

export interface DocumentCommentEditorValue {
  content: string;
  editorData: DocumentCommentJson;
}

export type DocumentCommentUpdateHandler = (
  comment: DocumentCommentItem,
  value: DocumentCommentEditorValue,
) => Promise<void>;

export const isOptimisticDocumentComment = (comment: Pick<DocumentCommentItem, 'id'>) =>
  comment.id.startsWith('optimistic:');

const compareComments = (first: DocumentCommentItem, second: DocumentCommentItem) => {
  const timeDelta = new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
  return timeDelta || first.id.localeCompare(second.id);
};

export const flattenDocumentCommentThreads = (pages: DocumentCommentThreadPage[] | undefined) => {
  const threads = new Map<string, DocumentCommentThreadPage['items'][number]>();
  for (const thread of pages?.flatMap((page) => page.items) ?? []) {
    threads.set(thread.root.id, thread);
  }
  return [...threads.values()].sort((first, second) => compareComments(first.root, second.root));
};

export const flattenDocumentCommentReplies = (pages: DocumentCommentReplyPage[] | undefined) => {
  const replies = new Map<string, DocumentCommentItem>();
  for (const reply of pages?.flatMap((page) => page.items) ?? []) replies.set(reply.id, reply);
  const chronologicalReplies = [...replies.values()].sort(compareComments);
  const childrenByReplyId = new Map<string, DocumentCommentItem[]>();
  const threadReplies: DocumentCommentItem[] = [];

  for (const reply of chronologicalReplies) {
    const targetId = reply.replyToCommentId;
    if (targetId && targetId !== reply.id && replies.has(targetId)) {
      const children = childrenByReplyId.get(targetId) ?? [];
      children.push(reply);
      childrenByReplyId.set(targetId, children);
    } else {
      threadReplies.push(reply);
    }
  }

  const orderedReplies: DocumentCommentItem[] = [];
  const visitedIds = new Set<string>();
  const appendReplyTree = (reply: DocumentCommentItem) => {
    if (visitedIds.has(reply.id)) return;
    visitedIds.add(reply.id);
    orderedReplies.push(reply);
    for (const child of childrenByReplyId.get(reply.id) ?? []) appendReplyTree(child);
  };

  for (const reply of threadReplies) appendReplyTree(reply);
  for (const reply of chronologicalReplies) appendReplyTree(reply);
  return orderedReplies;
};

export const createOptimisticComment = ({
  author,
  clientId,
  content,
  documentId,
  editorData,
  parentCommentId,
  replyTo = null,
  userId,
  workspaceId,
}: CreateOptimisticCommentParams): DocumentCommentItem => {
  const now = new Date();

  return {
    author,
    authorUserId: userId,
    canDelete: false,
    canEdit: false,
    clientId,
    content,
    createdAt: now,
    deletedAt: null,
    documentId,
    editorData,
    id: `optimistic:${clientId}`,
    parentCommentId: parentCommentId ?? null,
    replyTo,
    replyToCommentId: replyTo?.id ?? null,
    updatedAt: now,
    workspaceId,
  };
};

export const appendOptimisticThread = (
  pages: DocumentCommentThreadPage[] | undefined,
  comment: DocumentCommentItem,
): DocumentCommentThreadPage[] => {
  if (!pages?.length) return [{ items: [{ replyCount: 0, root: comment }], nextCursor: null }];
  if (pages.some((page) => page.items.some(({ root }) => root.clientId === comment.clientId))) {
    return pages;
  }

  const nextPages = [...pages];
  const lastPage = nextPages.at(-1)!;
  nextPages[nextPages.length - 1] = {
    ...lastPage,
    items: [...lastPage.items, { replyCount: 0, root: comment }],
  };
  return nextPages;
};

export const replaceOptimisticThread = (
  pages: DocumentCommentThreadPage[] | undefined,
  comment: DocumentCommentItem,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((thread) =>
      thread.root.clientId === comment.clientId ? { ...thread, root: comment } : thread,
    ),
  }));

export const replaceThreadComment = (
  pages: DocumentCommentThreadPage[] | undefined,
  comment: DocumentCommentItem,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((thread) =>
      thread.root.id === comment.id ? { ...thread, root: comment } : thread,
    ),
  }));

export const removeOptimisticThread = (
  pages: DocumentCommentThreadPage[] | undefined,
  clientId: string,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.filter(({ root }) => root.clientId !== clientId),
  }));

export const appendOptimisticReply = (
  pages: DocumentCommentReplyPage[] | undefined,
  comment: DocumentCommentItem,
): DocumentCommentReplyPage[] => {
  if (!pages?.length) return [{ items: [comment], nextCursor: null, total: 1 }];
  if (pages.some((page) => page.items.some((item) => item.clientId === comment.clientId))) {
    return pages;
  }

  const nextPages = [...pages];
  const lastPage = nextPages.at(-1)!;
  nextPages[nextPages.length - 1] = {
    ...lastPage,
    items: [...lastPage.items, comment],
    ...(lastPage.total === undefined ? {} : { total: lastPage.total + 1 }),
  };
  return nextPages;
};

export const replaceOptimisticReply = (
  pages: DocumentCommentReplyPage[] | undefined,
  comment: DocumentCommentItem,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((item) => (item.clientId === comment.clientId ? comment : item)),
  }));

export const replaceReplyComment = (
  pages: DocumentCommentReplyPage[] | undefined,
  comment: DocumentCommentItem,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((item) => (item.id === comment.id ? comment : item)),
  }));

export const removeOptimisticReply = (
  pages: DocumentCommentReplyPage[] | undefined,
  clientId: string,
) =>
  pages?.map((page) => {
    const removedCount = page.items.filter((item) => item.clientId === clientId).length;
    return {
      ...page,
      items: page.items.filter((item) => item.clientId !== clientId),
      ...(page.total === undefined ? {} : { total: Math.max(0, page.total - removedCount) }),
    };
  });

export const updateThreadReplyCount = (
  pages: DocumentCommentThreadPage[] | undefined,
  rootCommentId: string,
  delta: number,
) =>
  pages?.map((page) => ({
    ...page,
    items: page.items.map((thread) =>
      thread.root.id === rootCommentId
        ? { ...thread, replyCount: Math.max(0, thread.replyCount + delta) }
        : thread,
    ),
  }));
