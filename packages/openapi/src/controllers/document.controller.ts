import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { DocumentRestService } from '../services/document.service';
import type {
  CreateDocumentRequest,
  DocumentIdParam,
  DocumentListQuery,
  UpdateDocumentRequest,
} from '../types/document.type';

/** Documents controller — list, read, create and replace documents. */
export class DocumentController extends BaseController {
  private async service(c: Context): Promise<DocumentRestService> {
    return new DocumentRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/documents */
  async listDocuments(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<DocumentListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listDocuments(query), {
        message: 'Document list retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/documents/:id */
  async getDocument(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<DocumentIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getDocument(id), 'Document retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/documents */
  async createDocument(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateDocumentRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createDocument(body), 'Document created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/documents/:id */
  async updateDocument(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<DocumentIdParam>(c);
      const body = await this.getBody<UpdateDocumentRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateDocument(id, body), 'Document updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
