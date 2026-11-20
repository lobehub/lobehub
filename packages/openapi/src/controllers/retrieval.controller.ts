import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { RetrievalRestService } from '../services/retrieval.service';
import type { FileSearchRequest, KnowledgeBaseSearchRequest } from '../types/retrieval.type';

/** Semantic search over files / knowledge bases and the indexing tasks behind it. */
export class RetrievalController extends BaseController {
  private async service(c: Context): Promise<RetrievalRestService> {
    return new RetrievalRestService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** POST /api/v1/knowledge-bases/:id/search */
  async searchKnowledgeBase(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<KnowledgeBaseSearchRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.searchKnowledgeBase(id, body), 'Search completed');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/files/search */
  async searchFiles(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<FileSearchRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.searchFiles(body), 'Search completed');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/files/:id/embeddings */
  async embedFile(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.embedFile(id), 'Embedding task queued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/files/:id/parses/retry */
  async retryParse(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const service = await this.service(c);
      return this.success(c, await service.retryParse(id), 'Parse task queued', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
