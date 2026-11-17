import { randomUUID } from 'node:crypto';

import type { DocumentCommentItem } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { documentCommentRouter } from '@/server/routers/lambda/documentComment';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type {
  CreateDocumentCommentRequest,
  DocumentCommentListQuery,
  DocumentCommentReplyQuery,
  UpdateDocumentCommentRequest,
} from '../types/document-comment.type';
import { toIso } from './document.service';

const toComment = (item: DocumentCommentItem) => ({
  author: item.author,
  authorUserId: item.authorUserId,
  canDelete: item.canDelete,
  canEdit: item.canEdit,
  clientId: item.clientId,
  content: item.content,
  createdAt: toIso(item.createdAt),
  deletedAt: item.deletedAt ? toIso(item.deletedAt) : null,
  documentId: item.documentId,
  editorData: (item.editorData ?? null) as Record<string, unknown> | null,
  id: item.id,
  parentCommentId: item.parentCommentId,
  replyTo: item.replyTo,
  replyToCommentId: item.replyToCommentId,
  selectionAnchor: item.selectionAnchor,
  updatedAt: toIso(item.updatedAt),
  workspaceId: item.workspaceId,
});

/**
 * Document comments REST service.
 *
 * A thin shell over the `documentComment` tRPC procedures (called server-side),
 * so REST comments get the same per-action RBAC, page visibility check,
 * mention validation, activity notifications and live-update events as the
 * editor's comment panel. Comments are a workspace feature: personal-mode
 * calls answer 412.
 */
export class DocumentCommentRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get comments() {
    if (!this.workspaceId) {
      throw new ApiException(
        412,
        'precondition_failed',
        'Document comments are only available inside a workspace; send the X-Workspace-Id header',
      );
    }
    return documentCommentRouter.createCaller(this.ctx);
  }

  /** A comment addressed through a document it does not belong to is as missing as any other. */
  private async requireComment(documentId: string, commentId: string) {
    const comment = await this.comments.get({ id: commentId });
    if (comment.documentId !== documentId) {
      throw this.createNotFoundError('Document comment not found');
    }
    return comment;
  }

  async listThreads(documentId: string, query: DocumentCommentListQuery) {
    const page = await this.comments.listThreads({
      anchored: query.anchored,
      cursor: query.cursor,
      documentId,
      limit: query.limit,
    });
    return {
      hasMore: page.nextCursor !== null,
      items: page.items.map((thread) => ({
        replyCount: thread.replyCount,
        root: toComment(thread.root),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async createComment(documentId: string, body: CreateDocumentCommentRequest) {
    const result = await this.comments.create({
      clientId: body.clientId ?? randomUUID(),
      content: body.content,
      documentId,
      editorData: body.editorData as never,
      parentCommentId: body.parentCommentId,
      selectionAnchor: body.selectionAnchor,
    });
    return { comment: toComment(result.comment), isDuplicate: result.isDuplicate };
  }

  async listReplies(documentId: string, commentId: string, query: DocumentCommentReplyQuery) {
    await this.requireComment(documentId, commentId);
    const page = await this.comments.listReplies({
      cursor: query.cursor,
      limit: query.limit,
      rootCommentId: commentId,
    });
    return {
      hasMore: page.nextCursor !== null,
      items: page.items.map(toComment),
      nextCursor: page.nextCursor,
    };
  }

  async updateComment(documentId: string, commentId: string, body: UpdateDocumentCommentRequest) {
    await this.requireComment(documentId, commentId);
    const comment = await this.comments.update({
      content: body.content,
      editorData: body.editorData as never,
      id: commentId,
    });
    return toComment(comment);
  }

  async deleteComment(documentId: string, commentId: string) {
    await this.requireComment(documentId, commentId);
    const { mode } = await this.comments.delete({ id: commentId });
    return { id: commentId, mode };
  }
}
