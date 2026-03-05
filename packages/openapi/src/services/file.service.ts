import type { FileMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { and, count, desc, eq, gte, ilike, inArray, lte, sum } from 'drizzle-orm';
import { sha256 } from 'js-sha256';

import type { PERMISSION_ACTIONS } from '@/const/rbac';
import { ALL_SCOPE } from '@/const/rbac';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import type { FileItem } from '@/database/schemas';
import {
  agentsToSessions,
  files,
  filesToSessions,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { S3 } from '@/server/modules/S3';
import { FileS3 } from '@/server/modules/S3';
import { DocumentService } from '@/server/services/document';
import { FileService as CoreFileService } from '@/server/services/file';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { nanoid } from '@/utils/uuid';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type {
  AsyncTaskErrorResponse,
  BatchFileUploadRequest,
  BatchFileUploadResponse,
  BatchGetFilesRequest,
  BatchGetFilesResponse,
  FileAsyncTaskResponse,
  FileChunkRequest,
  FileChunkResponse,
  FileDetailResponse,
  FileListQuery,
  FileListResponse,
  FileParseRequest,
  FileParseResponse,
  FileUrlRequest,
  FileUrlResponse,
  PublicFileUploadRequest,
} from '../types/file.type';
import type {
  KnowledgeBaseFileBatchRequest,
  KnowledgeBaseFileListQuery,
  KnowledgeBaseFileOperationResult,
  MoveKnowledgeBaseFilesRequest,
  MoveKnowledgeBaseFilesResponse,
} from '../types/knowledge-base.type';

/**
 * 文件上传服务类
 * 专门处理服务端模式的文件上传和管理功能
 */
export class FileUploadService extends BaseService {
  private fileModel: FileModel;
  private documentModel: DocumentModel;
  private coreFileService: CoreFileService;
  private documentService: DocumentService;
  private s3Service: S3;
  private chunkModel: ChunkModel;
  private asyncTaskModel: AsyncTaskModel;
  private knowledgeBaseModel: KnowledgeBaseModel;
  // 延迟引入 ChunkService，避免循环依赖开销
  // 注意：ChunkService 仅在服务端环境可用

  constructor(db: LobeChatDatabase, userId: string) {
    super(db, userId);
    this.fileModel = new FileModel(db, userId);
    this.documentModel = new DocumentModel(db, userId);
    this.coreFileService = new CoreFileService(db, userId!);
    this.documentService = new DocumentService(db, userId);
    this.s3Service = new FileS3();
    this.chunkModel = new ChunkModel(db, userId);
    this.asyncTaskModel = new AsyncTaskModel(db, userId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, userId);
  }

  /**
   * 确保获取完整URL，避免重复拼接
   * 检查URL是否已经是完整URL，如果不是则生成完整URL
   */
  private async ensureFullUrl(url?: string): Promise<string> {
    if (!url) {
      return '';
    }

    // 检查URL是否已经是完整URL（向后兼容历史数据）
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url; // 已经是完整URL，直接返回
    } else {
      // 相对路径，生成完整URL
      return await this.coreFileService.getFullFileUrl(url);
    }
  }

  /**
   * 转换为上传响应格式
   */
  private async convertToResponse(file: FileItem): Promise<FileDetailResponse['file']> {
    const fullUrl = await this.ensureFullUrl(file.url);

    return {
      ...file,
      url: fullUrl || file.url,
    };
  }

  /**
   * 校验知识库归属（仅允许当前用户的知识库）
   */
  private async assertOwnedKnowledgeBase(
    knowledgeBaseId: string,
    action: keyof typeof PERMISSION_ACTIONS,
  ) {
    const permissionResult = await this.resolveOperationPermission(action, {
      targetKnowledgeBaseId: knowledgeBaseId,
    });
    if (!permissionResult.isPermitted) {
      throw this.createAuthorizationError(permissionResult.message || '无权访问知识库文件');
    }

    const knowledgeBase = await this.db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, knowledgeBaseId),
    });

    if (!knowledgeBase) {
      throw this.createNotFoundError('知识库不存在或无权访问');
    }

    return knowledgeBase;
  }

  /**
   * 批量文件上传
   */
  async uploadFiles(request: BatchFileUploadRequest): Promise<BatchFileUploadResponse> {
    try {
      const isPermitted = await this.resolveOperationPermission('FILE_UPLOAD');
      if (!isPermitted.isPermitted) {
        throw this.createAuthorizationError(isPermitted.message || '无权上传文件');
      }

      const results: BatchFileUploadResponse = {
        failed: [],
        successful: [],
        summary: {
          failed: 0,
          successful: 0,
          total: request.files.length,
        },
      };

      for (const file of request.files) {
        try {
          const result = await this.uploadFile(file, {
            agentId: request.agentId,
            directory: request.directory,
            knowledgeBaseId: request.knowledgeBaseId,
            sessionId: request.sessionId,
            skipCheckFileType: request.skipCheckFileType,
          });
          results.successful.push(result);
          results.summary.successful++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.failed.push({
            error: errorMessage,
            name: file.name,
          });
          results.summary.failed++;
          this.log('warn', 'File upload failed in batch', {
            error: errorMessage,
            name: file.name,
          });
        }
      }

      return results;
    } catch (error) {
      this.handleServiceError(error, '批量上传文件');
    }
  }

  /**
   * 获取文件列表，支持三种场景：
   * 1. 获取当前用户的文件（默认）
   * 2. 获取指定用户的文件（需要 ALL 权限，或目标用户是自己）
   * 3. 获取系统中所有用户的文件（需要 ALL 权限，queryAll=true）
   */
  async getFileList(request: FileListQuery): Promise<FileListResponse> {
    try {
      // 检查是否有全局权限
      const hasGlobalPermission = await this.hasGlobalPermission('FILE_READ');

      // 根据请求参数决定权限校验的资源范围
      // 1. queryAll=true 时，使用 ALL_SCOPE 查询全量数据
      // 2. 指定 userId 时，查询指定用户的数据
      // 3. 如果查询知识库文件且有全局权限，使用 ALL_SCOPE 以获取所有文件
      // 4. 否则查询当前用户的数据
      let resourceInfo: { targetUserId: string } | typeof ALL_SCOPE | undefined;

      if (request.queryAll) {
        resourceInfo = ALL_SCOPE;
      } else if (request.userId) {
        resourceInfo = { targetUserId: request.userId };
      } else if (request.knowledgeBaseId && hasGlobalPermission) {
        // 查询知识库文件时，如果有全局权限，可查询所有文件
        resourceInfo = ALL_SCOPE;
      }

      const permissionResult = await this.resolveOperationPermission('FILE_READ', resourceInfo);

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问文件列表');
      }

      this.log('info', 'Getting file list', {
        ...request,
        hasGlobalPermission,
        queryAll: request.queryAll,
      });

      // 计算分页参数
      const { limit, offset } = processPaginationConditions(request);

      // 构建查询条件
      const { knowledgeBaseId } = request;

      // 如果指定了知识库ID，使用 JOIN 查询
      if (knowledgeBaseId) {
        // 构建查询条件
        const whereConditions = [
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          ...this.buildFileWhereConditions(request, permissionResult),
        ];

        const whereClause = and(...whereConditions);

        // 使用 JOIN 查询知识库关联的文件
        const baseQuery = this.db
          .select({ file: files })
          .from(knowledgeBaseFiles)
          .innerJoin(files, eq(knowledgeBaseFiles.fileId, files.id))
          .where(whereClause)
          .orderBy(desc(files.createdAt));

        const listQuery =
          limit !== undefined && offset !== undefined
            ? baseQuery.limit(limit).offset(offset)
            : baseQuery;

        const [records, totalResult] = await Promise.all([
          listQuery,
          this.db
            .select({ count: count(), totalSize: sum(files.size) })
            .from(knowledgeBaseFiles)
            .innerJoin(files, eq(knowledgeBaseFiles.fileId, files.id))
            .where(whereClause),
        ]);

        const filesResult: FileItem[] = records.map((row) => row.file);
        const total = totalResult[0]?.count || 0;

        // 构建响应 (JOIN查询需要手动获取关联数据)
        const responseFiles = await this.buildFileListResponse(
          filesResult,
          true,
          hasGlobalPermission,
        );

        this.log('info', 'File list retrieved successfully (by knowledgeBase)', {
          count: responseFiles.length,
          knowledgeBaseId,
          total,
        });

        return {
          files: responseFiles,
          total,
          totalSize: totalResult[0]?.totalSize || '0',
        };
      }

      // 未指定知识库ID，使用关系查询(自动 join user 和 knowledgeBases)
      const whereConditions = this.buildFileWhereConditions(request, permissionResult);
      const whereClause = and(...whereConditions);

      // 当前 files 关系未定义 user/knowledgeBases，采用基础查询并手动补齐关联数据
      const queryOptions = {
        limit,
        offset,
        orderBy: desc(files.createdAt),
        where: whereClause,
      };

      const [filesResult, totalResult] = await Promise.all([
        this.db.query.files.findMany(queryOptions),
        this.db
          .select({ count: count(), totalSize: sum(files.size) })
          .from(files)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.count || 0;

      // 构建响应 (关系查询已包含 user 和 knowledgeBases)
      const responseFiles = await this.buildFileListResponse(
        filesResult,
        true,
        hasGlobalPermission,
      );

      this.log('info', 'File list retrieved successfully', {
        count: responseFiles.length,
        total,
      });

      return {
        files: responseFiles,
        total,
        totalSize: totalResult[0]?.totalSize || '0',
      };
    } catch (error) {
      this.handleServiceError(error, '获取文件列表');
    }
  }

  /**
   * 获取指定知识库下的文件列表
   * 复用 getFileList 的查询逻辑，但使用 KNOWLEDGE_BASE_READ 权限
   */
  async getKnowledgeBaseFileList(
    knowledgeBaseId: string,
    request: KnowledgeBaseFileListQuery,
  ): Promise<FileListResponse> {
    try {
      // 权限校验（知识库读取权限）
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问知识库文件列表');
      }

      // 校验知识库访问权限与存在性
      const knowledgeBase = await this.knowledgeBaseModel.findById(knowledgeBaseId);
      if (!knowledgeBase) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      this.log('info', 'Getting knowledge base file list', {
        knowledgeBaseId,
        request,
      });

      // 复用 getFileList 的查询逻辑
      const fileListQuery: FileListQuery = {
        ...request,
        knowledgeBaseId,
      };

      const result = await this.getFileList(fileListQuery);

      this.log('info', 'Knowledge base file list retrieved successfully', {
        count: result.files.length,
        knowledgeBaseId,
        total: result.total,
      });

      return result;
    } catch (error) {
      this.handleServiceError(error, '获取知识库文件列表');
    }
  }

  /**
   * 批量创建知识库与文件的关联
   */
  async addFilesToKnowledgeBase(
    knowledgeBaseId: string,
    request: KnowledgeBaseFileBatchRequest,
  ): Promise<KnowledgeBaseFileOperationResult> {
    try {
      await this.assertOwnedKnowledgeBase(knowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');

      const uniqueFileIds = Array.from(new Set(request.fileIds));
      if (uniqueFileIds.length === 0) {
        throw this.createValidationError('文件ID列表不能为空');
      }

      const ownedFiles = await this.db.query.files.findMany({
        columns: { id: true },
        where: and(inArray(files.id, uniqueFileIds), eq(files.userId, this.userId)),
      });
      const ownedIds = ownedFiles.map((file) => file.id);

      const failed = uniqueFileIds
        .filter((fileId) => !ownedIds.includes(fileId))
        .map((fileId) => ({ fileId, reason: '文件不存在或无权访问' }));

      if (ownedIds.length) {
        await this.db
          .insert(knowledgeBaseFiles)
          .values(
            ownedIds.map((fileId) => ({
              fileId,
              knowledgeBaseId,
              userId: this.userId,
            })),
          )
          .onConflictDoNothing();
      }

      return {
        failed,
        successed: ownedIds,
      };
    } catch (error) {
      this.handleServiceError(error, '批量添加知识库文件关联');
    }
  }

  /**
   * 批量移除知识库与文件的关联
   */
  async removeFilesFromKnowledgeBase(
    knowledgeBaseId: string,
    request: KnowledgeBaseFileBatchRequest,
  ): Promise<KnowledgeBaseFileOperationResult> {
    try {
      const uniqueFileIds = Array.from(new Set(request.fileIds));
      if (uniqueFileIds.length === 0) {
        throw this.createValidationError('文件ID列表不能为空');
      }

      await this.assertOwnedKnowledgeBase(knowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');

      const ownedFiles = await this.db.query.files.findMany({
        columns: { id: true },
        where: and(inArray(files.id, uniqueFileIds), eq(files.userId, this.userId)),
      });
      const ownedIds = ownedFiles.map((file) => file.id);

      const failed = uniqueFileIds
        .filter((fileId) => !ownedIds.includes(fileId))
        .map((fileId) => ({ fileId, reason: '文件不存在或无权访问' }));

      if (ownedIds.length) {
        await this.db
          .delete(knowledgeBaseFiles)
          .where(
            and(
              eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
              eq(knowledgeBaseFiles.userId, this.userId),
              inArray(knowledgeBaseFiles.fileId, ownedIds),
            ),
          );
      }

      return {
        failed,
        successed: ownedIds,
      };
    } catch (error) {
      this.handleServiceError(error, '批量移除知识库文件关联');
    }
  }

  /**
   * 批量移动文件到另一个知识库
   */
  async moveFilesBetweenKnowledgeBases(
    sourceKnowledgeBaseId: string,
    request: MoveKnowledgeBaseFilesRequest,
  ): Promise<MoveKnowledgeBaseFilesResponse> {
    try {
      if (sourceKnowledgeBaseId === request.targetKnowledgeBaseId) {
        throw this.createValidationError('目标知识库不能与源知识库相同');
      }

      // 校验知识库归属
      await this.assertOwnedKnowledgeBase(sourceKnowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');
      await this.assertOwnedKnowledgeBase(request.targetKnowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');

      // 校验文件归属
      const uniqueFileIds = Array.from(new Set(request.fileIds));

      const ownedFiles = await this.db.query.files.findMany({
        columns: { id: true },
        where: and(inArray(files.id, uniqueFileIds), eq(files.userId, this.userId)),
      });

      const ownedIds = ownedFiles.map((file) => file.id);

      const failed: MoveKnowledgeBaseFilesResponse['failed'] = uniqueFileIds
        .filter((fileId) => !ownedIds.includes(fileId))
        .map((fileId) => ({ fileId, reason: '文件不存在或无权访问' }));

      if (!ownedIds.length) {
        return {
          failed,
          successed: [],
        };
      }

      await this.db.transaction(async (trx) => {
        await trx
          .delete(knowledgeBaseFiles)
          .where(
            and(
              eq(knowledgeBaseFiles.knowledgeBaseId, sourceKnowledgeBaseId),
              eq(knowledgeBaseFiles.userId, this.userId),
              inArray(knowledgeBaseFiles.fileId, ownedIds),
            ),
          );

        await trx
          .insert(knowledgeBaseFiles)
          .values(
            ownedIds.map((fileId) => ({
              fileId,
              knowledgeBaseId: request.targetKnowledgeBaseId,
              userId: this.userId,
            })),
          )
          .onConflictDoNothing();
      });

      return {
        failed,
        successed: ownedIds,
      };
    } catch (error) {
      this.handleServiceError(error, '移动知识库文件');
    }
  }

  /**
   * 获取文件详情
   */
  async getFileDetail(fileId: string): Promise<FileDetailResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 检查是否为图片文件
      const isImage = file.fileType.startsWith('image/');

      const convertedFile = await this.convertToResponse(file);

      if (!isImage) {
        // 非图片文件：获取解析结果
        try {
          const parseResult = await this.parseFile(fileId, { skipExist: true });

          return {
            file: convertedFile,
            parsed: parseResult,
          };
        } catch (parseError) {
          // 如果解析失败，仍然返回文件详情，但不包含解析结果
          this.log('warn', 'Failed to parse file content', {
            error: parseError,
            fileId,
          });

          return {
            file: convertedFile,
            parsed: {
              error: parseError instanceof Error ? parseError.message : 'Unknown error',
              fileId,
              fileType: file.fileType,
              name: file.name,
              parseStatus: 'failed',
            },
          };
        }
      }

      return {
        file: convertedFile,
      };
    } catch (error) {
      this.handleServiceError(error, '获取文件详情');
    }
  }

  /**
   * 获取文件预签名访问URL
   */
  async getFileUrl(fileId: string, options: FileUrlRequest = {}): Promise<FileUrlResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 设置过期时间（默认1小时）
      const expiresIn = options.expiresIn || 3600;

      // 使用S3服务生成预签名URL
      const signedUrl = await this.s3Service.createPreSignedUrlForPreview(file.url, expiresIn);

      // 计算过期时间戳
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      this.log('info', 'File URL generated successfully', {
        expiresIn,
        fileId,
        name: file.name,
      });

      return {
        expiresAt,
        expiresIn,
        fileId,
        name: file.name,
        url: signedUrl,
      };
    } catch (error) {
      this.handleServiceError(error, '获取文件URL');
    }
  }

  /**
   * 文件上传
   */
  async uploadFile(file: File, options: PublicFileUploadRequest = {}): Promise<FileDetailResponse> {
    try {
      const isPermitted = await this.resolveOperationPermission('FILE_UPLOAD');

      if (!isPermitted.isPermitted) {
        throw this.createAuthorizationError(isPermitted.message || '无权上传文件');
      }

      this.log('info', 'Starting public file upload', {
        directory: options.directory,
        name: file.name,
        size: file.size,
        type: file.type,
      });

      // 1. 验证文件
      await this.validateFile(file, options.skipCheckFileType);

      // 2. 计算文件哈希
      const fileArrayBuffer = await file.arrayBuffer();
      const hash = sha256(fileArrayBuffer);
      const resolvedSessionId = await this.resolveSessionId(options);

      // 3. 检查文件是否已存在（去重逻辑）
      if (!options.skipDeduplication) {
        const existingFileCheck = await this.fileModel.checkHash(hash);

        if (existingFileCheck.isExist) {
          this.log('info', 'Public file already exists, checking user file record', {
            existingUrl: existingFileCheck.url,
            hash,
            name: file.name,
          });

          // 检查当前用户是否已经有这个文件的记录
          const existingUserFile = await this.findExistingUserFile(hash);

          if (existingUserFile) {
            // 用户已有此文件记录，直接返回
            this.log('info', 'User already has this public file record', {
              fileId: existingUserFile.id,
              name: existingUserFile.name,
            });

            // 如果提供了 sessionId（支持 agentId 解析），创建文件和会话的关联关系
            if (resolvedSessionId) {
              await this.createFileSessionRelation(existingUserFile.id, resolvedSessionId);
              this.log('info', 'Existing public file associated with session', {
                fileId: existingUserFile.id,
                sessionId: resolvedSessionId,
              });
            }

            return await this.getFileDetail(existingUserFile.id);
          } else {
            // 文件在全局表中存在，但用户没有记录，创建用户文件记录
            this.log('info', 'Public file exists globally, creating user file record', {
              hash,
              name: file.name,
            });

            const fileRecord = {
              chunkTaskId: null,
              clientId: null,
              embeddingTaskId: null,
              fileHash: hash,
              fileType: file.type,
              knowledgeBaseId: options.knowledgeBaseId,
              metadata: existingFileCheck.metadata as FileMetadata,
              name: file.name,
              size: file.size,
              url: existingFileCheck.url || '',
              userId: this.userId,
            };

            const createResult = await this.fileModel.create(fileRecord, false); // 不插入全局表，因为已存在

            // 如果提供了 sessionId（支持 agentId 解析），创建文件和会话的关联关系
            if (resolvedSessionId) {
              await this.createFileSessionRelation(createResult.id, resolvedSessionId);
              this.log('info', 'Deduplicated public file associated with session', {
                fileId: createResult.id,
                sessionId: resolvedSessionId,
              });
            }

            this.log('info', 'Deduplicated public file created successfully', {
              fileId: createResult.id,
              path: existingFileCheck.url,
              sessionId: resolvedSessionId,
              size: file.size,
              url: existingFileCheck.url,
            });

            return await this.getFileDetail(createResult.id);
          }
        }
      }

      // 4. 文件不存在，正常上传流程
      const metadata = this.generateFileMetadata(file, options.directory);

      // 5. 上传到 S3
      const fileBuffer = Buffer.from(fileArrayBuffer);
      await this.s3Service.uploadBuffer(metadata.path, fileBuffer, file.type);

      // 7. 保存文件记录到数据库
      const fileRecord = {
        chunkTaskId: null,
        clientId: null,
        embeddingTaskId: null,
        fileHash: hash,
        fileType: file.type,
        knowledgeBaseId: options.knowledgeBaseId,
        metadata,
        name: file.name,
        size: file.size,
        url: metadata.path,
        userId: this.userId,
      };

      const createResult = await this.fileModel.create(fileRecord, true);

      // 如果提供了 sessionId（支持 agentId 解析），创建文件和会话的关联关系
      if (resolvedSessionId) {
        await this.createFileSessionRelation(createResult.id, resolvedSessionId);
        this.log('info', 'Public file associated with session', {
          fileId: createResult.id,
          sessionId: resolvedSessionId,
        });
      }

      return await this.getFileDetail(createResult.id);
    } catch (error) {
      this.handleServiceError(error, '上传文件');
    }
  }

  /**
   * 解析文件内容
   */
  async parseFile(
    fileId: string,
    options: Partial<FileParseRequest> = {},
  ): Promise<FileParseResponse> {
    try {
      // 1. 权限校验
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      // 2. 查询文件
      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 3. 检查文件类型是否支持解析
      if (isChunkingUnsupported(file.fileType)) {
        throw this.createBusinessError(
          `File type '${file.fileType}' does not support content parsing`,
        );
      }

      // 4. 检查是否已经解析过（如果不跳过已存在的）
      if (!options.skipExist) {
        const existingDocument = await this.documentModel.findByFileId(fileId);
        if (existingDocument) {
          this.log('info', 'File already parsed, returning existing result', { fileId });

          return {
            content: existingDocument.content as string,
            fileId,
            fileType: file.fileType,
            metadata: {
              pages: existingDocument.pages?.length || 0,
              title: existingDocument.title || undefined,
              totalCharCount: existingDocument.totalCharCount || undefined,
              totalLineCount: existingDocument.totalLineCount || undefined,
            },
            name: file.name,
            parseStatus: 'completed',
            parsedAt: existingDocument.createdAt.toISOString(),
          };
        }
      }

      this.log('info', 'Starting file parsing', {
        fileId,
        fileType: file.fileType,
        name: file.name,
        skipExist: options.skipExist,
      });

      try {
        // 5. 使用 DocumentService 解析文件
        const document = await this.documentService.parseFile(fileId);

        this.log('info', 'File parsed successfully', {
          contentLength: document.content?.length || 0,
          fileId,
          pages: document.pages,
          totalCharCount: document.totalCharCount,
        });

        // 6. 返回解析结果
        return {
          content: document.content || '',
          fileId,
          fileType: file.fileType,
          metadata: {
            pages: document.pages?.length || 0,
            title: document.title || undefined,
            totalCharCount: document.totalCharCount || undefined,
            totalLineCount: document.totalLineCount || undefined,
          },
          name: file.name,
          parseStatus: 'completed',
          parsedAt: new Date().toISOString(),
        };
      } catch (parseError) {
        const errorMessage =
          parseError instanceof Error ? parseError.message : 'Unknown parsing error';

        this.log('error', 'File parsing failed', {
          error: errorMessage,
          fileId,
          name: file.name,
        });

        // 返回失败结果
        return {
          content: '',
          error: errorMessage,
          fileId,
          fileType: file.fileType,
          name: file.name,
          parseStatus: 'failed',
          parsedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      this.handleServiceError(error, '解析文件');
    }
  }

  /**
   * 创建分块任务（可选自动触发嵌入）
   */
  async createChunkTask(
    fileId: string,
    req: Partial<FileChunkRequest> = {},
  ): Promise<FileChunkResponse> {
    try {
      // 权限：更新文件即可
      const permissionResult = await this.resolveOperationPermission('FILE_UPDATE', {
        targetFileId: fileId,
      });
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权操作该文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      if (isChunkingUnsupported(file.fileType)) {
        throw this.createBusinessError(`File type '${file.fileType}' does not support chunking`);
      }

      // 触发分块异步任务
      const { ChunkService } = await import('@/server/services/chunk');
      const chunkService = new ChunkService(this.db, this.userId);

      const chunkTaskId = await chunkService.asyncParseFileToChunks(fileId, req.skipExist);

      let embeddingTaskId: string | null | undefined = null;
      if (req.autoEmbedding) {
        embeddingTaskId = await chunkService.asyncEmbeddingFileChunks(fileId);
      }

      this.log('info', 'Chunk task created', {
        autoEmbedding: !!req.autoEmbedding,
        chunkTaskId,
        embeddingTaskId,
        fileId,
      });

      return {
        chunkTaskId: chunkTaskId || null,
        embeddingTaskId: embeddingTaskId || null,
        fileId,
        message: 'Task created',
        success: true,
      };
    } catch (error) {
      this.handleServiceError(error, '创建分块任务');
    }
  }

  /**
   * 查询文件分块与嵌入任务状态
   */
  async getFileChunkStatus(fileId: string) {
    try {
      // 权限：读取文件即可
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      const [chunkCount, chunkTask, embeddingTask] = await Promise.all([
        this.chunkModel.countByFileId(fileId),
        file.chunkTaskId ? this.asyncTaskModel.findById(file.chunkTaskId) : Promise.resolve(null),
        file.embeddingTaskId
          ? this.asyncTaskModel.findById(file.embeddingTaskId)
          : Promise.resolve(null),
      ]);

      return {
        chunkCount,
        chunkingError: (chunkTask?.error as any) || null,
        chunkingStatus: (chunkTask?.status as AsyncTaskStatus | null | undefined) || null,
        embeddingError: (embeddingTask?.error as any) || null,
        embeddingStatus: (embeddingTask?.status as AsyncTaskStatus | null | undefined) || null,
        finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
      };
    } catch (error) {
      this.handleServiceError(error, '查询文件分块状态');
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('FILE_DELETE', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 删除S3文件
      await this.coreFileService.deleteFile(file.url);

      // 删除数据库记录及关联 chunks / global_files
      await this.fileModel.delete(fileId);

      this.log('info', 'File deleted successfully', { fileId, key: file.url });

      return;
    } catch (error) {
      this.handleServiceError(error, '删除文件');
    }
  }

  /**
   * 验证文件
   */
  private async validateFile(file: File, skipCheckFileType = false): Promise<void> {
    // 文件大小限制 (100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw this.createBusinessError(
        `File size exceeds maximum limit of ${maxSize / 1024 / 1024}MB`,
      );
    }

    // 文件名长度限制
    if (file.name.length > 255) {
      throw this.createBusinessError('Filename is too long (max 255 characters)');
    }

    // 检查文件类型（如果未跳过检查）
    if (!skipCheckFileType) {
      const allowedTypes = [
        'image/',
        'video/',
        'audio/',
        'text/',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/x-yaml',
        'application/yaml',
        'application/json',
      ];

      // 基于文件扩展名的额外验证（用于处理 application/octet-stream 等通用类型）
      const allowedExtensions = [
        '.yaml',
        '.yml',
        '.json',
        '.txt',
        '.md',
        '.xml',
        '.csv',
        '.tsv',
        '.pdf',
        '.doc',
        '.docx',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.bmp',
        '.webp',
        '.svg',
        '.mp4',
        '.avi',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.mp3',
        '.wav',
        '.ogg',
        '.aac',
        '.flac',
        '.m4a',
      ];

      const isAllowed = allowedTypes.some((type) => file.type.startsWith(type));
      const fileExtension = file.name.toLowerCase().slice(Math.max(0, file.name.lastIndexOf('.')));
      const isExtensionAllowed = allowedExtensions.includes(fileExtension);

      // 如果文件类型不被允许，但扩展名是允许的（处理 application/octet-stream 等情况）
      if (!isAllowed && !isExtensionAllowed) {
        throw this.createBusinessError(`File type '${file.type}' is not supported`);
      }
    }
  }

  /**
   * 生成文件元数据
   */
  private generateFileMetadata(file: File, directory?: string): FileMetadata {
    const now = new Date();
    const datePath = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const dir = directory || 'uploads';
    const filename = `${nanoid()}_${file.name}`;
    const path = `${dir}/${datePath}/${filename}`;

    return {
      date: now.toISOString(),
      dirname: dir,
      filename,
      path,
    };
  }

  /**
   * 解析上传请求中的 sessionId（agentId 优先，sessionId 兼容）
   */
  private async resolveSessionId(options: PublicFileUploadRequest): Promise<string | undefined> {
    if (!options.agentId) {
      return options.sessionId;
    }

    const relation = await this.db.query.agentsToSessions.findFirst({
      columns: { sessionId: true },
      where: and(
        eq(agentsToSessions.agentId, options.agentId),
        eq(agentsToSessions.userId, this.userId),
      ),
    });

    if (!relation) {
      this.log('warn', 'No session relation found for agent, fallback to sessionId', {
        agentId: options.agentId,
        sessionId: options.sessionId,
      });
      return options.sessionId;
    }

    return relation.sessionId;
  }

  /**
   * 创建文件和会话的关联关系
   */
  private async createFileSessionRelation(fileId: string, sessionId: string): Promise<void> {
    try {
      await this.db
        .insert(filesToSessions)
        .values({
          fileId,
          sessionId,
          userId: this.userId,
        })
        .onConflictDoNothing();

      this.log('info', 'File-session relation created', {
        fileId,
        sessionId,
        userId: this.userId,
      });
    } catch (error) {
      this.handleServiceError(error, '创建文件和会话的关联关系');
    }
  }

  /**
   * 批量获取文件详情和内容
   */
  async handleQueries(request: BatchGetFilesRequest): Promise<BatchGetFilesResponse> {
    try {
      this.log('info', 'Starting batch file retrieval', {
        count: request.fileIds.length,
        fileIds: request.fileIds,
      });

      const files: BatchGetFilesResponse['files'] = [];
      const failed: BatchGetFilesResponse['failed'] = [];

      // 并行处理所有文件
      const promises = request.fileIds.map(async (fileId) => {
        try {
          // 获取文件详情
          const fileDetail = await this.getFileDetail(fileId);

          files.push(fileDetail);
        } catch (error) {
          this.log('error', 'Failed to get file detail', {
            error,
            fileId,
          });

          failed.push({
            error: error instanceof Error ? error.message : 'Unknown error',
            fileId,
          });
        }
      });

      // 等待所有异步操作完成
      await Promise.all(promises);

      const result: BatchGetFilesResponse = {
        failed,
        files,
        success: files.length,
        total: request.fileIds.length,
      };

      this.log('info', 'Batch file retrieval completed', {
        failed: result.failed.length,
        success: result.success,
        total: result.total,
      });

      return result;
    } catch (error) {
      this.handleServiceError(error, '批量获取文件详情和内容');
    }
  }

  /**
   * 查找用户是否已有指定哈希的文件记录
   */
  private async findExistingUserFile(hash: string): Promise<FileItem | null> {
    try {
      const existingFile = await this.db.query.files.findFirst({
        where: and(eq(files.fileHash, hash), eq(files.userId, this.userId)),
      });

      return existingFile || null;
    } catch (error) {
      this.handleServiceError(error, '查找用户是否已有指定哈希的文件记录');
    }
  }

  /**
   * 构建文件查询的 WHERE 条件
   */
  private buildFileWhereConditions(
    request: FileListQuery,
    permissionResult: {
      condition?: { userId?: string };
      isPermitted: boolean;
      message?: string;
    },
  ) {
    const { keyword, fileType, updatedAtStart, updatedAtEnd } = request;
    const conditions = [];

    // 权限条件
    if (permissionResult?.condition?.userId) {
      conditions.push(eq(files.userId, permissionResult.condition.userId));
    }

    // 关键词搜索
    if (keyword) {
      conditions.push(ilike(files.name, `%${keyword}%`));
    }

    // 文件类型过滤
    if (fileType) {
      conditions.push(ilike(files.fileType, `${fileType}%`));
    }

    // 更新时间区间
    if (updatedAtStart) {
      conditions.push(gte(files.updatedAt, new Date(updatedAtStart)));
    }
    if (updatedAtEnd) {
      conditions.push(lte(files.updatedAt, new Date(updatedAtEnd)));
    }

    return conditions;
  }

  /**
   * 根据权限结果查询单个文件
   * @param fileId 文件 ID
   * @param permissionResult 权限校验结果
   * @returns 文件记录，如果找不到则抛出错误
   */
  private async findFileByIdWithPermission(
    fileId: string,
    permissionResult: { condition?: { userId?: string } },
  ): Promise<FileItem> {
    const whereConditions = [eq(files.id, fileId)];
    if (permissionResult.condition?.userId) {
      whereConditions.push(eq(files.userId, permissionResult.condition.userId));
    }

    const file = await this.db.query.files.findFirst({
      where: and(...whereConditions),
    });

    if (!file) {
      throw this.createCommonError('File not found');
    }

    return file;
  }

  /**
   * 批量获取文件关联数据并构建响应
   * @param filesResult 文件列表(FileItem 或带关系的文件对象)
   * @param needsManualRelationFetch 是否需要手动获取关联数据(JOIN查询时需要)
   * @param hasGlobalPermission 是否有全局权限（决定是否显示所有关联用户）
   */
  private async buildFileListResponse(
    filesResult: (FileItem & {
      knowledgeBases?: any[];
      user?: any;
    })[],
    needsManualRelationFetch = false,
    hasGlobalPermission = false,
  ): Promise<FileDetailResponse['file'][]> {
    if (filesResult.length === 0) return [];

    // 1. 按 fileHash 去重（相同 hash 的文件只保留第一个）
    const uniqueFilesByHash = new Map<string, (typeof filesResult)[0]>();
    for (const file of filesResult) {
      const key = file.fileHash || file.id;
      if (!uniqueFilesByHash.has(key)) {
        uniqueFilesByHash.set(key, file);
      }
    }
    const dedupedFiles = Array.from(uniqueFilesByHash.values());

    const fileIds = dedupedFiles.map((file) => file.id);
    const fileHashes = dedupedFiles.map((file) => file.fileHash).filter(Boolean) as string[];

    // 批量查询分块、任务状态
    const [chunkCounts, chunkTasks, embeddingTasks] = await Promise.all([
      this.chunkModel.countByFileIds(fileIds),
      this.asyncTaskModel.findByIds(
        dedupedFiles.map((file) => file.chunkTaskId).filter(Boolean) as string[],
        AsyncTaskType.Chunking,
      ),
      this.asyncTaskModel.findByIds(
        dedupedFiles.map((file) => file.embeddingTaskId).filter(Boolean) as string[],
        AsyncTaskType.Embedding,
      ),
    ]);

    // 2. 查询所有相同 hash 的文件对应的用户
    // 只有全局权限时才查询所有用户，否则只返回当前文件的用户
    const hashUsersMap = new Map<string, any[]>();

    if (hasGlobalPermission && fileHashes.length > 0) {
      // 查询所有相同 hash 的文件
      const allFilesWithSameHash = await this.db.query.files.findMany({
        columns: { fileHash: true, userId: true },
        where: inArray(files.fileHash, fileHashes),
      });

      // 收集所有用户 ID
      const allUserIds = [...new Set(allFilesWithSameHash.map((f) => f.userId))];

      // 查询用户信息
      const allUsers =
        allUserIds.length > 0
          ? await this.db.query.users.findMany({
              columns: { avatar: true, email: true, fullName: true, id: true, username: true },
              where: inArray(users.id, allUserIds),
            })
          : [];

      // 构建 hash -> users 映射
      for (const file of allFilesWithSameHash) {
        if (!file.fileHash) continue;
        const user = allUsers.find((u) => u.id === file.userId);
        if (user) {
          if (!hashUsersMap.has(file.fileHash)) {
            hashUsersMap.set(file.fileHash, []);
          }
          // 避免重复添加同一用户
          const existingUsers = hashUsersMap.get(file.fileHash)!;
          if (!existingUsers.some((u) => u.id === user.id)) {
            existingUsers.push(user);
          }
        }
      }
    }

    // 如果是 JOIN 查询,需要单独查询知识库和用户信息
    let fileKnowledgeBases: any[] = [];
    let usersData: any[] = [];

    if (needsManualRelationFetch) {
      const userIds = [...new Set(dedupedFiles.map((file) => file.userId))];

      [fileKnowledgeBases, usersData] = await Promise.all([
        this.db
          .select({
            fileId: knowledgeBaseFiles.fileId,
            knowledgeBaseAvatar: knowledgeBases.avatar,
            knowledgeBaseDescription: knowledgeBases.description,
            knowledgeBaseId: knowledgeBases.id,
            knowledgeBaseName: knowledgeBases.name,
          })
          .from(knowledgeBaseFiles)
          .innerJoin(knowledgeBases, eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBases.id))
          .where(inArray(knowledgeBaseFiles.fileId, fileIds)),
        userIds.length > 0
          ? this.db.query.users.findMany({
              columns: {
                avatar: true,
                email: true,
                fullName: true,
                id: true,
                username: true,
              },
              where: inArray(users.id, userIds),
            })
          : [],
      ]);
    }

    // 构建响应数据
    return Promise.all(
      dedupedFiles.map(async (file) => {
        const base = await this.convertToResponse(file);

        const chunkCountItem = chunkCounts.find((c) => c.id === file.id);
        const chunkTask = file.chunkTaskId
          ? chunkTasks.find((task) => task.id === file.chunkTaskId)
          : null;
        const embeddingTask = file.embeddingTaskId
          ? embeddingTasks.find((task) => task.id === file.embeddingTaskId)
          : null;

        // 获取知识库信息
        const knowledgeBases = needsManualRelationFetch
          ? fileKnowledgeBases
              .filter((kb) => kb.fileId === file.id)
              .map((kb) => ({
                avatar: kb.knowledgeBaseAvatar,
                description: kb.knowledgeBaseDescription,
                id: kb.knowledgeBaseId,
                name: kb.knowledgeBaseName,
              }))
          : file.knowledgeBases?.map((kb) => kb.knowledgeBase) || [];

        // 获取用户信息
        let fileUsers = [];

        if (hasGlobalPermission && file.fileHash && hashUsersMap.has(file.fileHash)) {
          // 全局权限：返回所有关联该 hash 的用户
          fileUsers = hashUsersMap.get(file.fileHash) || [];
        } else {
          // 非全局权限：只返回当前文件的用户
          const currentUser = needsManualRelationFetch
            ? usersData.find((u) => u.id === file.userId) || null
            : file.user || null;
          if (currentUser) {
            fileUsers = [currentUser];
          }
        }

        let chunking: FileAsyncTaskResponse | null = null;

        if (chunkTask || chunkCountItem) {
          chunking = {
            count: chunkCountItem?.count ?? null,
            error: (chunkTask?.error as AsyncTaskErrorResponse | null) ?? null,
            id: chunkTask?.id,
            status: (chunkTask?.status as FileAsyncTaskResponse['status']) ?? null,
            type: chunkTask?.type as FileAsyncTaskResponse['type'],
          };
        }

        const embedding: FileAsyncTaskResponse | null = embeddingTask
          ? {
              error: (embeddingTask.error as AsyncTaskErrorResponse | null) ?? null,
              id: embeddingTask.id,
              status: (embeddingTask.status as FileAsyncTaskResponse['status']) ?? null,
              type: embeddingTask.type as FileAsyncTaskResponse['type'],
            }
          : null;

        return {
          ...base,
          chunking,
          embedding,
          knowledgeBases,
          users: fileUsers,
        };
      }),
    );
  }

  /**
   * 更新文件
   * PATCH /files/:id
   */
  async updateFile(
    fileId: string,
    updateData: { knowledgeBaseId?: string | null },
  ): Promise<FileDetailResponse> {
    try {
      // 1. 权限校验
      const permissionResult = await this.resolveOperationPermission('FILE_UPDATE', {
        targetFileId: fileId,
      });
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新文件');
      }

      // 2. 查询文件
      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 3. 处理知识库关联
      if ('knowledgeBaseId' in updateData) {
        await this.db.transaction(async (trx) => {
          // 删除现有的知识库关联（对于全局权限用户，使用文件的实际 userId）
          const targetUserId = file.userId;
          await trx
            .delete(knowledgeBaseFiles)
            .where(
              and(
                eq(knowledgeBaseFiles.fileId, fileId),
                eq(knowledgeBaseFiles.userId, targetUserId),
              ),
            );

          // 如果提供了新的知识库ID，创建新的关联
          if (updateData.knowledgeBaseId) {
            // 验证知识库是否存在且用户有权访问
            const knowledgeBase = await this.knowledgeBaseModel.findById(
              updateData.knowledgeBaseId,
            );

            if (!knowledgeBase) {
              throw this.createNotFoundError('知识库不存在或无权访问');
            }

            await trx.insert(knowledgeBaseFiles).values({
              fileId,
              knowledgeBaseId: updateData.knowledgeBaseId,
              userId: targetUserId,
            });
          }
        });
      }

      // 4. 获取更新后的文件详情
      const updatedFile = await this.getFileDetail(fileId);

      return updatedFile;
    } catch (error) {
      this.handleServiceError(error, '更新文件');
    }
  }
}
