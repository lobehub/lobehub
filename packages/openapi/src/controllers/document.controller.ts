import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { DocumentRestService } from '../services/document.service';
import { DocumentCommentRestService } from '../services/document-comment.service';
import type {
  BatchCreateDocumentsRequest,
  BatchDeleteDocumentsRequest,
  CreateDocumentRequest,
  DocumentIdParam,
  DocumentListQuery,
  DocumentVersionCompareQuery,
  DocumentVersionParam,
  MoveDocumentRequest,
  UpdateDocumentRequest,
} from '../types/document.type';
import type {
  CreateDocumentCommentRequest,
  DocumentCommentListQuery,
  DocumentCommentParam,
  DocumentCommentReplyQuery,
  UpdateDocumentCommentRequest,
} from '../types/document-comment.type';

/**
 * Documents controller: documents, their versions, share link and comments.
 * Handles HTTP concerns only — the rules live in the shared document services.
 */
export class DocumentController extends BaseController {
  private async documents(c: Context) {
    return new DocumentRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  private async comments(c: Context) {
    return new DocumentCommentRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** Answer `fn()` as a success envelope, or the shared error body. */
  private async respond(
    c: Context,
    fn: () => Promise<unknown>,
    message: string,
    status: 200 | 201 = 200,
  ): Promise<Response> {
    try {
      return this.success(c, await fn(), message, status);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  // ==================== Documents ====================

  /** GET /api/v1/documents */
  async listDocuments(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<DocumentListQuery>(c);
      const service = await this.documents(c);
      return this.list(c, 'items', await service.listDocuments(query), {
        message: 'Documents retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/documents */
  async createDocument(c: Context): Promise<Response> {
    const body = await this.getBody<CreateDocumentRequest>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).createDocument(body),
      'Document created',
      201,
    );
  }

  /** POST /api/v1/documents/batch */
  async batchCreateDocuments(c: Context): Promise<Response> {
    const body = await this.getBody<BatchCreateDocumentsRequest>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).batchCreateDocuments(body),
      'Documents created',
      201,
    );
  }

  /** POST /api/v1/documents/batch-delete */
  async batchDeleteDocuments(c: Context): Promise<Response> {
    const { ids } = await this.getBody<BatchDeleteDocumentsRequest>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).batchDeleteDocuments(ids),
      'Documents deleted',
    );
  }

  /** GET /api/v1/documents/:id */
  async getDocument(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).getDocument(id),
      'Document retrieved successfully',
    );
  }

  /** PATCH /api/v1/documents/:id */
  async updateDocument(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const body = await this.getBody<UpdateDocumentRequest>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).updateDocument(id, body),
      'Document updated',
    );
  }

  /** POST /api/v1/documents/:id/move */
  async moveDocument(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const { parentId } = await this.getBody<MoveDocumentRequest>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).moveDocument(id, parentId),
      'Document moved',
    );
  }

  /** GET /api/v1/documents/:id/breadcrumb */
  async getBreadcrumb(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).getBreadcrumb(id),
      'Breadcrumb retrieved successfully',
    );
  }

  /** DELETE /api/v1/documents/:id */
  async deleteDocument(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).deleteDocument(id),
      'Document deleted',
    );
  }

  // ==================== Versions ====================

  /** GET /api/v1/documents/:id/versions */
  async listVersions(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const query = this.getQuery<{ cursor?: string; limit?: number }>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).listVersions(id, query),
      'Versions retrieved successfully',
    );
  }

  /** POST /api/v1/documents/:id/versions */
  async saveVersion(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).saveVersion(id),
      'Version saved',
      201,
    );
  }

  /** GET /api/v1/documents/:id/versions/compare */
  async compareVersions(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const { from, to } = this.getQuery<DocumentVersionCompareQuery>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).compareVersions(id, from, to),
      'Versions compared',
    );
  }

  /** GET /api/v1/documents/:id/versions/:versionId */
  async getVersion(c: Context): Promise<Response> {
    const { id, versionId } = this.getParams<DocumentVersionParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).getVersion(id, versionId),
      'Version retrieved successfully',
    );
  }

  /** POST /api/v1/documents/:id/versions/:versionId/restore */
  async restoreVersion(c: Context): Promise<Response> {
    const { id, versionId } = this.getParams<DocumentVersionParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).restoreVersion(id, versionId),
      'Version restored',
    );
  }

  // ==================== Share ====================

  /** GET /api/v1/documents/:id/share */
  async getShare(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).getShare(id),
      'Share retrieved successfully',
    );
  }

  /** POST /api/v1/documents/:id/share */
  async enableShare(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).setShare(id, 'link'),
      'Share link enabled',
    );
  }

  /** DELETE /api/v1/documents/:id/share */
  async disableShare(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    return this.respond(
      c,
      async () => (await this.documents(c)).setShare(id, 'private'),
      'Share link disabled',
    );
  }

  // ==================== Comments ====================

  /** GET /api/v1/documents/:id/comments */
  async listComments(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const query = this.getQuery<DocumentCommentListQuery>(c);
    return this.respond(
      c,
      async () => (await this.comments(c)).listThreads(id, query),
      'Comments retrieved successfully',
    );
  }

  /** POST /api/v1/documents/:id/comments */
  async createComment(c: Context): Promise<Response> {
    const { id } = this.getParams<DocumentIdParam>(c);
    const body = await this.getBody<CreateDocumentCommentRequest>(c);
    return this.respond(
      c,
      async () => (await this.comments(c)).createComment(id, body),
      'Comment created',
      201,
    );
  }

  /** GET /api/v1/documents/:id/comments/:commentId/replies */
  async listCommentReplies(c: Context): Promise<Response> {
    const { commentId, id } = this.getParams<DocumentCommentParam>(c);
    const query = this.getQuery<DocumentCommentReplyQuery>(c);
    return this.respond(
      c,
      async () => (await this.comments(c)).listReplies(id, commentId, query),
      'Replies retrieved successfully',
    );
  }

  /** PATCH /api/v1/documents/:id/comments/:commentId */
  async updateComment(c: Context): Promise<Response> {
    const { commentId, id } = this.getParams<DocumentCommentParam>(c);
    const body = await this.getBody<UpdateDocumentCommentRequest>(c);
    return this.respond(
      c,
      async () => (await this.comments(c)).updateComment(id, commentId, body),
      'Comment updated',
    );
  }

  /** DELETE /api/v1/documents/:id/comments/:commentId */
  async deleteComment(c: Context): Promise<Response> {
    const { commentId, id } = this.getParams<DocumentCommentParam>(c);
    return this.respond(
      c,
      async () => (await this.comments(c)).deleteComment(id, commentId),
      'Comment deleted',
    );
  }
}
