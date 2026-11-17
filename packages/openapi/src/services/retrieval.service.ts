import { AsyncTaskStatus } from '@lobechat/types';
import { HTTPException } from 'hono/http-exception';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import type { LobeChatDatabase } from '@/database/type';
import { getChunkingLoaderType } from '@/libs/document-loaders/loaderType';
import {
  KnowledgeBaseSearchService,
  type SemanticSearchForChatResult,
} from '@/server/services/knowledgeBase';
import {
  assertContentsNotInRestrictedKnowledgeBase,
  assertFileNotInRestrictedKnowledgeBase,
  assertKnowledgeBaseBrowsable,
} from '@/server/services/knowledgeBaseAccess';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type {
  FileSearchRequest,
  FileSearchResult,
  FileTaskAccepted,
  KnowledgeBaseSearchRequest,
  KnowledgeBaseSearchResult,
} from '../types/retrieval.type';
import { describeRelayFailure } from './heterogeneous-direct.service';

const DEFAULT_TOP_K = 20;

const toIso = (value: Date | string): string => new Date(value).toISOString();

/**
 * Retrieval (RAG) REST service: semantic search over files and knowledge
 * bases, and the indexing tasks that feed it.
 *
 * Search runs through `KnowledgeBaseSearchService.semanticSearchForChat`, the
 * same orchestration the chat runtime and the `chunk` tRPC router use, so the
 * embedding model, the caller-scoped knowledge-base → file resolution and the
 * BM25 path stay in one place. Indexing goes through `ChunkService`, like the
 * `chunk.createEmbeddingChunksTask` / `retryParseFileTask` procedures. This
 * layer resolves the target rows first so a resource the caller cannot see is
 * a 404 instead of an empty result, and applies the restricted-knowledge-base
 * rule that guards reading chunk text.
 */
export class RetrievalRestService extends BaseService {
  private readonly asyncTaskModel: AsyncTaskModel;
  private readonly chunkModel: ChunkModel;
  private readonly fileModel: FileModel;
  private readonly knowledgeBaseModel: KnowledgeBaseModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.asyncTaskModel = new AsyncTaskModel(db, this.userId, workspaceId);
    this.chunkModel = new ChunkModel(db, this.userId, workspaceId);
    this.fileModel = new FileModel(db, this.userId, workspaceId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(db, this.userId, workspaceId);
  }

  private get accessCtx() {
    return { serverDB: this.db, userId: this.userId, workspaceId: this.workspaceId };
  }

  private get searchService() {
    return new KnowledgeBaseSearchService(
      this.db,
      this.userId,
      this.workspaceId,
      undefined,
      this.userId,
    );
  }

  private async chunkService() {
    // Lazy, like `FileUploadService`: the chunk service pulls in the async router graph.
    const { ChunkService } = await import('@/server/services/chunk');
    return new ChunkService(this.db, this.userId, this.workspaceId);
  }

  /**
   * The vector path failed and nothing else matched: an embedding-provider
   * failure must not read as "no results". A provider rejection keeps its
   * actionable status (invalid key → 401, quota → 429, else 502), classified
   * the same way the model relays do; anything else (e.g. the database) is
   * logged and answered without internal detail.
   */
  private assertSearchRan(result: SemanticSearchForChatResult) {
    if (!result.errors?.vector || result.totalResults > 0) return;

    const rejection = result.rejections?.vector;
    if (rejection && typeof rejection === 'object' && 'errorType' in rejection) {
      const failure = describeRelayFailure(rejection);
      // The error catalogue infers the code (unauthorized / rate_limited / upstream_error) from the status.
      throw new HTTPException(failure.status, {
        message: `Embedding provider failed: ${failure.message}`,
      });
    }
    this.log('error', 'Semantic search failed', { error: rejection ?? result.errors.vector });
    throw new ApiException(500, 'internal_error', 'Semantic search failed');
  }

  private toFileResult(result: SemanticSearchForChatResult): FileSearchResult {
    const chunks = result.chunks.map((chunk) => ({
      fileId: chunk.fileId ?? null,
      fileName: chunk.fileName ?? null,
      id: chunk.id,
      // `ChunkModel.semanticSearchForChat` selects it; the shared chunk type omits it.
      index: (chunk as { index?: number | null }).index ?? null,
      similarity: Number(chunk.similarity),
      text: chunk.text ?? null,
    }));
    return { chunks, files: result.fileResults, total: chunks.length };
  }

  /** Vector search over the base's files plus BM25 over the documents stored in it. */
  async searchKnowledgeBase(
    knowledgeBaseId: string,
    request: KnowledgeBaseSearchRequest,
  ): Promise<KnowledgeBaseSearchResult> {
    const knowledgeBase = await this.knowledgeBaseModel.findById(knowledgeBaseId);
    if (!knowledgeBase) throw this.createNotFoundError('Knowledge base not found');
    // Search answers with chunk text, i.e. the base's content.
    await assertKnowledgeBaseBrowsable(this.accessCtx, knowledgeBaseId);

    const result = await this.searchService.semanticSearchForChat({
      knowledgeIds: [knowledgeBaseId],
      query: request.query,
      topK: request.topK ?? DEFAULT_TOP_K,
    });
    this.assertSearchRan(result);

    const files = this.toFileResult(result);
    const documents = result.documents.map((hit) => ({
      documentId: hit.documentId,
      fileId: hit.fileId ?? null,
      knowledgeBaseId: hit.knowledgeBaseId,
      relevance: Number(hit.relevance),
      snippet: hit.snippet,
      title: hit.title,
      updatedAt: toIso(hit.updatedAt),
    }));
    return { ...files, documents, total: files.chunks.length + documents.length };
  }

  /** Vector search over an explicit set of the caller's files. */
  async searchFiles(request: FileSearchRequest): Promise<FileSearchResult> {
    const fileIds = [...new Set(request.fileIds)];
    const visible = new Set((await this.fileModel.findByIds(fileIds)).map((file) => file.id));
    const missing = fileIds.filter((id) => !visible.has(id));
    if (missing.length > 0) {
      throw new ApiException(404, 'not_found', `File not found: ${missing.join(', ')}`);
    }
    await assertContentsNotInRestrictedKnowledgeBase(this.accessCtx, fileIds);

    const result = await this.searchService.semanticSearchForChat({
      fileIds,
      query: request.query,
      topK: request.topK ?? DEFAULT_TOP_K,
    });
    this.assertSearchRan(result);
    return this.toFileResult(result);
  }

  private async requireFile(fileId: string) {
    const file = await this.fileModel.findById(fileId);
    if (!file) throw this.createNotFoundError('File not found');
    await assertFileNotInRestrictedKnowledgeBase(this.accessCtx, fileId);
    return file;
  }

  private async accepted(fileId: string, taskId: string): Promise<FileTaskAccepted> {
    const task = await this.asyncTaskModel.findById(taskId);
    return {
      fileId,
      status: (task?.status as FileTaskAccepted['status'] | undefined) ?? AsyncTaskStatus.Pending,
      taskId,
    };
  }

  /** Queue embedding of the file's chunks (`chunk.createEmbeddingChunksTask`). */
  async embedFile(fileId: string): Promise<FileTaskAccepted> {
    await this.requireFile(fileId);
    if ((await this.chunkModel.countByFileId(fileId)) === 0) {
      throw new ApiException(
        409,
        'conflict',
        'File has no chunks to embed yet; parse it with POST /files/{id}/chunks first',
      );
    }

    const taskId = await (await this.chunkService()).asyncEmbeddingFileChunks(fileId);
    if (!taskId) throw this.createNotFoundError('File not found');
    return this.accepted(fileId, taskId);
  }

  /**
   * Drop the file's previous chunking task and queue a fresh one
   * (`chunk.retryParseFileTask`).
   */
  async retryParse(fileId: string): Promise<FileTaskAccepted> {
    const file = await this.requireFile(fileId);
    // Refuse before touching the previous task: a 422 must leave state as it was.
    if (!getChunkingLoaderType(file.name)) {
      throw new ApiException(
        422,
        'unprocessable_entity',
        `'${file.name}' cannot be parsed into chunks: no loader supports this file extension`,
      );
    }
    if (file.chunkTaskId) await this.asyncTaskModel.delete(file.chunkTaskId);

    const taskId = await (await this.chunkService()).asyncParseFileToChunks(fileId);
    if (!taskId) throw this.createNotFoundError('File not found');
    return this.accepted(fileId, taskId);
  }
}
