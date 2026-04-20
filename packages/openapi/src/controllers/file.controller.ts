import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { FileUploadService } from '../services/file.service';
import type {
  BatchFileUploadRequest,
  BatchGetFilesRequest,
  FileChunkRequest,
  FileListQuery,
  FileParseRequest,
  FileUrlRequest,
  PublicFileUploadRequest,
  UpdateFileRequest,
} from '../types/file.type';

/**
 * File upload controller
 * Handles file upload-related HTTP requests
 */
export class FileController extends BaseController {
  /**
   * Batch file upload
   * POST /files/batches
   */
  async batchUploadFiles(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      // Process multipart/form-data (returns object: { fields, files })
      const formData = await this.getFormData(c);
      const files: File[] = [];

      // Compatibility: get files from 'files' or 'files[]' field
      // because the Stainless SDK automatically appends [] suffix to array fields
      let fileEntries = formData.getAll('files');
      if (fileEntries.length === 0) {
        fileEntries = formData.getAll('files[]');
      }

      for (const file of fileEntries) {
        if (file instanceof File) files.push(file);
      }

      if (!files.length) {
        return this.error(c, 'No files provided', 400);
      }

      // Get other parameters
      const knowledgeBaseId = (formData.get('knowledgeBaseId') as string | null) || null;
      const skipCheckFileType = formData.get('skipCheckFileType') === 'true';
      const directory = (formData.get('directory') as string | null) || null;
      const agentId = (formData.get('agentId') as string | null) || null;
      const sessionId = (formData.get('sessionId') as string | null) || null;

      const request: BatchFileUploadRequest = {
        agentId: agentId || undefined,
        directory: directory || undefined,
        files,
        knowledgeBaseId: knowledgeBaseId || undefined,
        sessionId: sessionId || undefined,
        skipCheckFileType,
      };

      const result = await fileService.uploadFiles(request);

      return this.success(
        c,
        result,
        `Batch upload completed: ${result.summary.successful} successful, ${result.summary.failed} failed`,
      );
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves the file list
   * GET /files
   */
  async getFiles(c: Context) {
    try {
      const userId = this.getUserId(c)!;

      const query = this.getQuery(c) as FileListQuery;

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.getFileList(query);

      return this.success(c, result, 'Files retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves a single file's details
   * GET /files/:id
   */
  async getFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const { id } = this.getParams(c);
      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.getFileDetail(id);

      return this.success(c, result, 'File details retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves the file access URL
   * GET /files/:id/url
   */
  async getFileUrl(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const { id } = this.getParams(c);
      const query = this.getQuery(c);

      // Parse query parameters
      const options: FileUrlRequest = {
        expiresIn: query.expiresIn ? parseInt(query.expiresIn as string, 10) : undefined,
      };

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.getFileUrl(id, options);

      return this.success(c, result, 'File URL generated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * File upload
   * POST /files
   */
  async uploadFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const formData = await this.getFormData(c);
      const file = formData.get('file') as File | null;

      if (!file) {
        return this.error(c, 'No file provided', 400);
      }

      // Get other parameters
      const knowledgeBaseId = (formData.get('knowledgeBaseId') as string | null) || null;
      const skipCheckFileType = formData.get('skipCheckFileType') === 'true';
      const directory = (formData.get('directory') as string | null) || null;
      const agentId = (formData.get('agentId') as string | null) || null;
      const sessionId = (formData.get('sessionId') as string | null) || null;
      const skipDeduplication = formData.get('skipDeduplication') === 'true';

      const options: PublicFileUploadRequest = {
        agentId: agentId || undefined,
        directory: directory || undefined,
        knowledgeBaseId: knowledgeBaseId || undefined,
        sessionId: sessionId || undefined,
        skipCheckFileType,
        skipDeduplication,
      };

      const result = await fileService.uploadFile(file, options);

      return this.success(c, result, 'Public file uploaded successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Parses file content
   * POST /files/:id/parses
   */
  async parseFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const { id } = this.getParams(c);
      const query = this.getQuery<{ skipExist?: boolean }>(c);

      // Parse query parameters
      const options: Partial<FileParseRequest> = {
        skipExist: query.skipExist,
      };

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.parseFile(id, options);

      return this.success(c, result, 'File parsed successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a chunking task (optionally auto-triggers embedding)
   * POST /files/:id/chunks
   */
  async createChunkTask(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth ensures userId exists
      const { id } = this.getParams(c);
      const body = await this.getBody<Partial<FileChunkRequest>>(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.createChunkTask(id, {
        autoEmbedding: body?.autoEmbedding,
        skipExist: body?.skipExist,
      });

      return this.success(c, result, 'Chunking task created');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves file chunk results and status
   * GET /files/:id/chunks
   */
  async getFileChunkStatus(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth ensures userId exists
      const { id } = this.getParams(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.getFileChunkStatus(id);

      return this.success(c, result, 'File chunk status retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes a file
   * DELETE /files/:id
   */
  async deleteFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const { id } = this.getParams(c);
      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.deleteFile(id);

      return this.success(c, result, 'File deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Batch retrieves file details and content
   * POST /files/queries
   */
  async queries(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const body = await this.getBody<BatchGetFilesRequest>(c);

      if (!body || !body.fileIds || body.fileIds.length === 0) {
        return this.error(c, 'File IDs are required', 400);
      }

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.handleQueries(body);

      return this.success(c, result, 'Files retrieved successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates a file
   * PATCH /files/:id
   */
  async updateFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth middleware ensures userId exists
      const { id } = this.getParams(c);
      const body = await this.getBody<UpdateFileRequest>(c);

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const result = await fileService.updateFile(id, body);

      return this.success(c, result, 'File updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
