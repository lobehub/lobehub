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
 * File upload service class
 * Handles file upload and management functionality in server mode
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
  // Lazy import ChunkService to avoid circular dependency overhead
  // Note: ChunkService is only available in server-side environments

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
   * Ensure a full URL is obtained, avoiding duplicate concatenation
   * Checks whether the URL is already a full URL; if not, generates the full URL
   */
  private async ensureFullUrl(url?: string): Promise<string> {
    if (!url) {
      return '';
    }

    // Check if URL is already a full URL (backward compatible with historical data)
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url; // Already a full URL, return directly
    } else {
      // Relative path, generate full URL
      return await this.coreFileService.getFullFileUrl(url);
    }
  }

  /**
   * Convert to upload response format
   */
  private async convertToResponse(file: FileItem): Promise<FileDetailResponse['file']> {
    const fullUrl = await this.ensureFullUrl(file.url);

    return {
      ...file,
      url: fullUrl || file.url,
    };
  }

  /**
   * Validate knowledge base ownership (only allows the current user's knowledge bases)
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
   * Batch file upload
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
   * Get file list, supporting three scenarios:
   * 1. Get files for the current user (default)
   * 2. Get files for a specified user (requires ALL permission, or target user is self)
   * 3. Get files for all users in the system (requires ALL permission, queryAll=true)
   */
  async getFileList(request: FileListQuery): Promise<FileListResponse> {
    try {
      // Check whether global permission is available
      const hasGlobalPermission = await this.hasGlobalPermission('FILE_READ');

      // Determine resource scope for permission check based on request parameters
      // 1. When queryAll=true, use ALL_SCOPE to query all data
      // 2. When userId is specified, query data for that user
      // 3. If querying knowledge base files and global permission exists, use ALL_SCOPE to get all files
      // 4. Otherwise query current user's data
      let resourceInfo: { targetUserId: string } | typeof ALL_SCOPE | undefined;

      if (request.queryAll) {
        resourceInfo = ALL_SCOPE;
      } else if (request.userId) {
        resourceInfo = { targetUserId: request.userId };
      } else if (request.knowledgeBaseId && hasGlobalPermission) {
        // When querying knowledge base files, if global permission exists, can query all files
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

      // Calculate pagination parameters
      const { limit, offset } = processPaginationConditions(request);

      // Build query conditions
      const { knowledgeBaseId } = request;

      // If knowledge base ID is specified, use JOIN query
      if (knowledgeBaseId) {
        // Build query conditions
        const whereConditions = [
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          ...this.buildFileWhereConditions(request, permissionResult),
        ];

        const whereClause = and(...whereConditions);

        // Use JOIN query for knowledge base associated files
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

        // Build response (JOIN query requires manually fetching associated data)
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

      // No knowledge base ID specified, use relational query (auto join user and knowledgeBases)
      const whereConditions = this.buildFileWhereConditions(request, permissionResult);
      const whereClause = and(...whereConditions);

      // Current files relation does not define user/knowledgeBases, use basic query and manually supplement associated data
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

      // Build response (relational query already includes user and knowledgeBases)
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
   * Get file list for a specified knowledge base
   * Reuses getFileList query logic but uses KNOWLEDGE_BASE_READ permission
   */
  async getKnowledgeBaseFileList(
    knowledgeBaseId: string,
    request: KnowledgeBaseFileListQuery,
  ): Promise<FileListResponse> {
    try {
      // Permission check (knowledge base read permission)
      const permissionResult = await this.resolveOperationPermission('KNOWLEDGE_BASE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问知识库文件列表');
      }

      // Validate knowledge base access permission and existence
      const knowledgeBase = await this.knowledgeBaseModel.findById(knowledgeBaseId);
      if (!knowledgeBase) {
        throw this.createNotFoundError('Knowledge base not found or access denied');
      }

      this.log('info', 'Getting knowledge base file list', {
        knowledgeBaseId,
        request,
      });

      // Reuse getFileList query logic
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
   * Batch create associations between knowledge bases and files
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
   * Batch remove associations between knowledge bases and files
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
   * Batch move files to another knowledge base
   */
  async moveFilesBetweenKnowledgeBases(
    sourceKnowledgeBaseId: string,
    request: MoveKnowledgeBaseFilesRequest,
  ): Promise<MoveKnowledgeBaseFilesResponse> {
    try {
      if (sourceKnowledgeBaseId === request.targetKnowledgeBaseId) {
        throw this.createValidationError('目标知识库不能与源知识库相同');
      }

      // Validate knowledge base ownership
      await this.assertOwnedKnowledgeBase(sourceKnowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');
      await this.assertOwnedKnowledgeBase(request.targetKnowledgeBaseId, 'KNOWLEDGE_BASE_UPDATE');

      // Validate file ownership
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
   * Get file detail
   */
  async getFileDetail(fileId: string): Promise<FileDetailResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // Check if the file is an image
      const isImage = file.fileType.startsWith('image/');

      const convertedFile = await this.convertToResponse(file);

      if (!isImage) {
        // Non-image file: get parse result
        try {
          const parseResult = await this.parseFile(fileId, { skipExist: true });

          return {
            file: convertedFile,
            parsed: parseResult,
          };
        } catch (parseError) {
          // If parsing fails, still return file details without parse result
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
   * Get file pre-signed access URL
   */
  async getFileUrl(fileId: string, options: FileUrlRequest = {}): Promise<FileUrlResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // Set expiry time (default 1 hour)
      const expiresIn = options.expiresIn || 3600;

      // Use S3 service to generate pre-signed URL
      const signedUrl = await this.s3Service.createPreSignedUrlForPreview(file.url, expiresIn);

      // Calculate expiry timestamp
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
   * File upload
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

      // 1. Validate file
      await this.validateFile(file, options.skipCheckFileType);

      // 2. Calculate file hash
      const fileArrayBuffer = await file.arrayBuffer();
      const hash = sha256(fileArrayBuffer);
      const resolvedSessionId = await this.resolveSessionId(options);

      // 3. Check if file already exists (deduplication logic)
      if (!options.skipDeduplication) {
        const existingFileCheck = await this.fileModel.checkHash(hash);

        if (existingFileCheck.isExist) {
          this.log('info', 'Public file already exists, checking user file record', {
            existingUrl: existingFileCheck.url,
            hash,
            name: file.name,
          });

          // Check if the current user already has a record for this file
          const existingUserFile = await this.findExistingUserFile(hash);

          if (existingUserFile) {
            // User already has this file record, return directly
            this.log('info', 'User already has this public file record', {
              fileId: existingUserFile.id,
              name: existingUserFile.name,
            });

            // If sessionId is provided (supports agentId resolution), create file-session association
            if (resolvedSessionId) {
              await this.createFileSessionRelation(existingUserFile.id, resolvedSessionId);
              this.log('info', 'Existing public file associated with session', {
                fileId: existingUserFile.id,
                sessionId: resolvedSessionId,
              });
            }

            return await this.getFileDetail(existingUserFile.id);
          } else {
            // File exists in global table but user has no record, create user file record
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

            const createResult = await this.fileModel.create(fileRecord, false); // Skip inserting into global table since it already exists

            // If sessionId is provided (supports agentId resolution), create file-session association
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

      // 4. File does not exist, proceed with normal upload flow
      const metadata = this.generateFileMetadata(file, options.directory);

      // 5. Upload to S3
      const fileBuffer = Buffer.from(fileArrayBuffer);
      await this.s3Service.uploadBuffer(metadata.path, fileBuffer, file.type);

      // 7. Save file record to database
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

      // If sessionId is provided (supports agentId resolution), create file-session association
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
   * Parse file content
   */
  async parseFile(
    fileId: string,
    options: Partial<FileParseRequest> = {},
  ): Promise<FileParseResponse> {
    try {
      // 1. Permission check
      const permissionResult = await this.resolveOperationPermission('FILE_READ', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此文件');
      }

      // 2. Query file
      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 3. Check if file type supports parsing
      if (isChunkingUnsupported(file.fileType)) {
        throw this.createBusinessError(
          `File type '${file.fileType}' does not support content parsing`,
        );
      }

      // 4. Check if file has already been parsed (if not skipping existing)
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
        // 5. Use DocumentService to parse file
        const document = await this.documentService.parseFile(fileId);

        this.log('info', 'File parsed successfully', {
          contentLength: document.content?.length || 0,
          fileId,
          pages: document.pages,
          totalCharCount: document.totalCharCount,
        });

        // 6. Return parse result
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

        // Return failure result
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
   * Create chunking task (optionally auto-trigger embedding)
   */
  async createChunkTask(
    fileId: string,
    req: Partial<FileChunkRequest> = {},
  ): Promise<FileChunkResponse> {
    try {
      // Permission: file update is sufficient
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

      // Trigger async chunking task
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
   * Query file chunking and embedding task status
   */
  async getFileChunkStatus(fileId: string) {
    try {
      // Permission: file read is sufficient
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
   * Delete file
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('FILE_DELETE', {
        targetFileId: fileId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除此文件');
      }

      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // Delete S3 file
      await this.coreFileService.deleteFile(file.url);

      // Delete database record and associated chunks / global_files
      await this.fileModel.delete(fileId);

      this.log('info', 'File deleted successfully', { fileId, key: file.url });

      return;
    } catch (error) {
      this.handleServiceError(error, '删除文件');
    }
  }

  /**
   * Validate file
   */
  private async validateFile(file: File, skipCheckFileType = false): Promise<void> {
    // File size limit (100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw this.createBusinessError(
        `File size exceeds maximum limit of ${maxSize / 1024 / 1024}MB`,
      );
    }

    // Filename length limit
    if (file.name.length > 255) {
      throw this.createBusinessError('Filename is too long (max 255 characters)');
    }

    // Check file type (if check is not skipped)
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

      // Additional validation based on file extension (for handling generic types like application/octet-stream)
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

      // If file type is not allowed but extension is allowed (handles application/octet-stream cases)
      if (!isAllowed && !isExtensionAllowed) {
        throw this.createBusinessError(`File type '${file.type}' is not supported`);
      }
    }
  }

  /**
   * Generate file metadata
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
   * Resolve sessionId from upload request (agentId takes priority, sessionId as fallback)
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
   * Create file-session association
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
   * Batch retrieve file details and content
   */
  async handleQueries(request: BatchGetFilesRequest): Promise<BatchGetFilesResponse> {
    try {
      this.log('info', 'Starting batch file retrieval', {
        count: request.fileIds.length,
        fileIds: request.fileIds,
      });

      const files: BatchGetFilesResponse['files'] = [];
      const failed: BatchGetFilesResponse['failed'] = [];

      // Process all files in parallel
      const promises = request.fileIds.map(async (fileId) => {
        try {
          // Get file detail
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

      // Wait for all async operations to complete
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
   * Find whether the user already has a file record for the specified hash
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
   * Build WHERE conditions for file queries
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

    // Permission conditions
    if (permissionResult?.condition?.userId) {
      conditions.push(eq(files.userId, permissionResult.condition.userId));
    }

    // Keyword search
    if (keyword) {
      conditions.push(ilike(files.name, `%${keyword}%`));
    }

    // File type filter
    if (fileType) {
      conditions.push(ilike(files.fileType, `${fileType}%`));
    }

    // Updated time range
    if (updatedAtStart) {
      conditions.push(gte(files.updatedAt, new Date(updatedAtStart)));
    }
    if (updatedAtEnd) {
      conditions.push(lte(files.updatedAt, new Date(updatedAtEnd)));
    }

    return conditions;
  }

  /**
   * Query a single file based on permission result
   * @param fileId File ID
   * @param permissionResult Permission check result
   * @returns File record, throws an error if not found
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
   * Batch fetch file associated data and build response
   * @param filesResult File list (FileItem or file objects with relations)
   * @param needsManualRelationFetch Whether to manually fetch associated data (required for JOIN queries)
   * @param hasGlobalPermission Whether global permission is available (determines whether to show all associated users)
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

    // 1. Deduplicate by fileHash (only keep the first file with the same hash)
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

    // Batch query chunk counts and task statuses
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

    // 2. Query users associated with all files having the same hash
    // Only query all users when global permission is available; otherwise only return the current file's user
    const hashUsersMap = new Map<string, any[]>();

    if (hasGlobalPermission && fileHashes.length > 0) {
      // Query all files with the same hash
      const allFilesWithSameHash = await this.db.query.files.findMany({
        columns: { fileHash: true, userId: true },
        where: inArray(files.fileHash, fileHashes),
      });

      // Collect all user IDs
      const allUserIds = [...new Set(allFilesWithSameHash.map((f) => f.userId))];

      // Query user info
      const allUsers =
        allUserIds.length > 0
          ? await this.db.query.users.findMany({
              columns: { avatar: true, email: true, fullName: true, id: true, username: true },
              where: inArray(users.id, allUserIds),
            })
          : [];

      // Build hash -> users mapping
      for (const file of allFilesWithSameHash) {
        if (!file.fileHash) continue;
        const user = allUsers.find((u) => u.id === file.userId);
        if (user) {
          if (!hashUsersMap.has(file.fileHash)) {
            hashUsersMap.set(file.fileHash, []);
          }
          // Avoid adding the same user twice
          const existingUsers = hashUsersMap.get(file.fileHash)!;
          if (!existingUsers.some((u) => u.id === user.id)) {
            existingUsers.push(user);
          }
        }
      }
    }

    // For JOIN queries, need to separately query knowledge base and user info
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

    // Build response data
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

        // Get knowledge base info
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

        // Get user info
        let fileUsers = [];

        if (hasGlobalPermission && file.fileHash && hashUsersMap.has(file.fileHash)) {
          // Global permission: return all users associated with this hash
          fileUsers = hashUsersMap.get(file.fileHash) || [];
        } else {
          // Non-global permission: only return the current file's user
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
   * Update file
   * PATCH /files/:id
   */
  async updateFile(
    fileId: string,
    updateData: { knowledgeBaseId?: string | null },
  ): Promise<FileDetailResponse> {
    try {
      // 1. Permission check
      const permissionResult = await this.resolveOperationPermission('FILE_UPDATE', {
        targetFileId: fileId,
      });
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新文件');
      }

      // 2. Query file
      const file = await this.findFileByIdWithPermission(fileId, permissionResult);

      // 3. Handle knowledge base association
      if ('knowledgeBaseId' in updateData) {
        await this.db.transaction(async (trx) => {
          // Delete existing knowledge base association (for global permission users, use the file's actual userId)
          const targetUserId = file.userId;
          await trx
            .delete(knowledgeBaseFiles)
            .where(
              and(
                eq(knowledgeBaseFiles.fileId, fileId),
                eq(knowledgeBaseFiles.userId, targetUserId),
              ),
            );

          // If a new knowledge base ID is provided, create a new association
          if (updateData.knowledgeBaseId) {
            // Validate that the knowledge base exists and the user has access
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

      // 4. Get updated file detail
      const updatedFile = await this.getFileDetail(fileId);

      return updatedFile;
    } catch (error) {
      this.handleServiceError(error, '更新文件');
    }
  }
}
