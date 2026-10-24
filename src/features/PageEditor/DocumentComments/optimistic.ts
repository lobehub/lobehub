import type {
  DocumentCommentAuthor,
  DocumentCommentItem,
  DocumentCommentJson,
  DocumentCommentSelectionAnchor,
  DocumentCommentThread,
} from '@lobechat/types';

import type { DocumentCommentEditorValue } from '@/store/documentComment';

interface CreateOptimisticCommentParams {
  author: DocumentCommentAuthor;
  clientId: string;
  content: string;
  documentId: string;
  editorData: DocumentCommentJson | null;
  parentCommentId?: string;
  replyTo?: DocumentCommentItem['replyTo'];
  selectionAnchor?: DocumentCommentSelectionAnchor;
  userId: string | null;
  workspaceId: string;
}

export interface DocumentCommentSubmitInput {
  clientId: string;
  content: string;
  editorData: DocumentCommentJson;
  /** Set only by the root composer, and only when the comment was started from a selection. */
  selectionAnchor?: DocumentCommentSelectionAnchor;
}

export type { DocumentCommentEditorValue };

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

/** A feed's roots, oldest first (an optimistic root sorts by its client-side time). */
export const flattenDocumentCommentThreads = (items: DocumentCommentThread[] | undefined) => {
  const threads = new Map<string, DocumentCommentThread>();
  for (const thread of items ?? []) threads.set(thread.root.id, thread);
  return [...threads.values()].sort((first, second) => compareComments(first.root, second.root));
};

/** A thread's replies, oldest first, each reply-to-reply placed right after its target. */
export const flattenDocumentCommentReplies = (items: DocumentCommentItem[] | undefined) => {
  const replies = new Map<string, DocumentCommentItem>();
  for (const reply of items ?? []) replies.set(reply.id, reply);
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
  selectionAnchor,
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
    selectionAnchor: selectionAnchor ?? null,
    updatedAt: now,
    workspaceId,
  };
};
