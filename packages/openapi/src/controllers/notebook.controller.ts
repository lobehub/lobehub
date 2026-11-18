import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { NotebookRestService } from '../services/notebook.service';
import type {
  AssociateNotebookDocumentRequest,
  CreateNotebookDocumentRequest,
  NotebookIdParam,
  NotebookListQuery,
  UpdateNotebookDocumentRequest,
} from '../types/notebook.type';

/**
 * Topic notebooks controller.
 * Handles HTTP concerns only — the notebook rules live in the shared notebook procedures.
 */
export class NotebookController extends BaseController {
  private async service(c: Context) {
    return new NotebookRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** GET /api/v1/notebooks */
  async listDocuments(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<NotebookListQuery>(c);
      const service = await this.service(c);
      return this.list(c, 'items', await service.listDocuments(query), {
        message: 'Notebook documents retrieved successfully',
        pagination: query,
      });
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notebooks */
  async createDocument(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateNotebookDocumentRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createDocument(body), 'Notebook document created', 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/notebooks/associate */
  async associateDocument(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<AssociateNotebookDocumentRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.associateDocument(body), 'Document added to notebook');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/notebooks/:id */
  async getDocument(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<NotebookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getDocument(id), 'Notebook document retrieved');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** PATCH /api/v1/notebooks/:id */
  async updateDocument(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<NotebookIdParam>(c);
      const body = await this.getBody<UpdateNotebookDocumentRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.updateDocument(id, body), 'Notebook document updated');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** DELETE /api/v1/notebooks/:id */
  async deleteDocument(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<NotebookIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.deleteDocument(id), 'Notebook document deleted');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
