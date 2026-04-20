import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { FileUploadService } from '../services/file.service';
import { KnowledgeBaseService } from '../services/knowledge-base.service';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBaseFileBatchRequest,
  KnowledgeBaseFileListQuery,
  KnowledgeBaseListQuery,
  MoveKnowledgeBaseFilesRequest,
  UpdateKnowledgeBaseRequest,
} from '../types/knowledge-base.type';

/**
 * Knowledge base controller
 * Handles knowledge base-related HTTP requests
 */
export class KnowledgeBaseController extends BaseController {
  /**
   * Retrieves the knowledge base list
   * GET /knowledge-bases
   */
  async getKnowledgeBases(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const query = this.getQuery(c) as KnowledgeBaseListQuery;

      const db = await this.getDatabase();
      const knowledgeBaseService = new KnowledgeBaseService(db, userId);

      const result = await knowledgeBaseService.getKnowledgeBaseList(query);

      return this.success(c, result, 'Knowledge bases retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves a single knowledge base's details
   * GET /knowledge-bases/:id
   */
  async getKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);

      const db = await this.getDatabase();
      const knowledgeBaseService = new KnowledgeBaseService(db, userId);

      const result = await knowledgeBaseService.getKnowledgeBaseDetail(id);

      return this.success(c, result, 'Knowledge base retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves the file list under a knowledge base
   * GET /knowledge-bases/:id/files
   */
  async getKnowledgeBaseFiles(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);
      const query = this.getQuery(c) as KnowledgeBaseFileListQuery;

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.getKnowledgeBaseFileList(id, query);

      return this.success(c, result, 'Knowledge base files retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Batch adds files to a knowledge base
   * POST /knowledge-bases/:id/files/batch
   */
  async addFilesToKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);
      const body = await this.getBody<KnowledgeBaseFileBatchRequest>(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.addFilesToKnowledgeBase(id, body);

      return this.success(c, result, 'Files added to knowledge base');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Batch removes files from a knowledge base
   * DELETE /knowledge-bases/:id/files/batch
   */
  async removeFilesFromKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);
      const body = await this.getBody<KnowledgeBaseFileBatchRequest>(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.removeFilesFromKnowledgeBase(id, body);

      return this.success(c, result, 'Files removed from knowledge base');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Batch moves files to another knowledge base
   * POST /knowledge-bases/:id/files/move
   */
  async moveFilesBetweenKnowledgeBases(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);
      const body = await this.getBody<MoveKnowledgeBaseFilesRequest>(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.moveFilesBetweenKnowledgeBases(id, body);

      return this.success(c, result, 'Files moved to target knowledge base');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a knowledge base
   * POST /knowledge-bases
   */
  async createKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const body = await this.getBody<CreateKnowledgeBaseRequest>(c);

      const db = await this.getDatabase();
      const knowledgeBaseService = new KnowledgeBaseService(db, userId);

      const result = await knowledgeBaseService.createKnowledgeBase(body);

      return this.success(c, result, 'Knowledge base created successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates a knowledge base
   * PATCH /knowledge-bases/:id
   */
  async updateKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);
      const body = await this.getBody<UpdateKnowledgeBaseRequest>(c);

      const db = await this.getDatabase();
      const knowledgeBaseService = new KnowledgeBaseService(db, userId);

      const result = await knowledgeBaseService.updateKnowledgeBase(id, body);

      return this.success(c, result, 'Knowledge base updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes a knowledge base
   * DELETE /knowledge-bases/:id
   */
  async deleteKnowledgeBase(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams(c);

      const db = await this.getDatabase();
      const knowledgeBaseService = new KnowledgeBaseService(db, userId);

      const result = await knowledgeBaseService.deleteKnowledgeBase(id);

      return this.success(c, result, 'Knowledge base deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
