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
 * 文件上传控制器
 * 处理文件上传相关的HTTP请求
 */
export class FileController extends BaseController {
  /**
   * 批量文件上传
   * POST /files/batches
   */
  async batchUploadFiles(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      // 处理 multipart/form-data（返回对象：{ fields, files }）
      const formData = await this.getFormData(c);
      const files: File[] = [];

      // 兼容写法：从 'files' 或 'files[]' 字段获取文件
      // 因为Stainless SDK 会将数组字段自动添加 [] 后缀
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

      // 获取其他参数
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
   * 获取文件列表
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
   * 获取单个文件详情
   * GET /files/:id
   */
  async getFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
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
   * 获取文件访问URL
   * GET /files/:id/url
   */
  async getFileUrl(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
      const { id } = this.getParams(c);
      const query = this.getQuery(c);

      // 解析查询参数
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
   * 文件上传
   * POST /files
   */
  async uploadFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在

      const db = await this.getDatabase();
      const fileService = new FileUploadService(db, userId);

      const formData = await this.getFormData(c);
      const file = formData.get('file') as File | null;

      if (!file) {
        return this.error(c, 'No file provided', 400);
      }

      // 获取其他参数
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
   * 解析文件内容
   * POST /files/:id/parses
   */
  async parseFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
      const { id } = this.getParams(c);
      const query = this.getQuery<{ skipExist?: boolean }>(c);

      // 解析查询参数
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
   * 创建分块任务（可选自动触发嵌入）
   * POST /files/:id/chunks
   */
  async createChunkTask(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 已确保 userId 存在
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
   * 查询文件分块结果和状态
   * GET /files/:id/chunks
   */
  async getFileChunkStatus(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 已确保 userId 存在
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
   * 删除文件
   * DELETE /files/:id
   */
  async deleteFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
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
   * 批量获取文件详情和内容
   * POST /files/queries
   */
  async queries(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
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
   * 更新文件
   * PATCH /files/:id
   */
  async updateFile(c: Context) {
    try {
      const userId = this.getUserId(c)!; // requireAuth 中间件已确保 userId 存在
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
