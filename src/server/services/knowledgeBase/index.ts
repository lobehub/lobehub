import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  type ChatSemanticSearchChunk,
  type FileSearchResult,
  RequestTrigger,
  type SemanticSearchSchemaType,
} from '@lobechat/types';
import { inArray } from 'drizzle-orm';
import pMap from 'p-map';

import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { type KnowledgeBaseDocumentHit, SearchRepo } from '@/database/repositories/search';
import { knowledgeBaseFiles } from '@/database/schemas';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { DocumentService } from '@/server/services/document';

export interface FileContentResult {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  metadata?: Record<string, any> | null;
  preview?: string;
  totalCharCount?: number;
  totalLineCount?: number;
}

export interface SemanticSearchForChatResult {
  chunks: ChatSemanticSearchChunk[];
  documents: KnowledgeBaseDocumentHit[];
  errors?: { bm25?: string; vector?: string };
  fileResults: FileSearchResult[];
  /**
   * Raw rejection reasons preserved for callers (e.g. lambda chunk router)
   * that need to map provider errors to TRPCError codes. Present only when
   * a search path failed.
   */
  rejections?: { bm25?: unknown; vector?: unknown };
  totalResults: number;
}

const groupAndRankFiles = (chunks: ChatSemanticSearchChunk[], topK: number): FileSearchResult[] => {
  const fileMap = new Map<string, FileSearchResult>();

  for (const chunk of chunks) {
    const fileId = chunk.fileId || 'unknown';
    const fileName = chunk.fileName || `File ${fileId}`;

    if (!fileMap.has(fileId)) {
      fileMap.set(fileId, { fileId, fileName, relevanceScore: 0, topChunks: [] });
    }

    fileMap.get(fileId)!.topChunks.push({
      id: chunk.id,
      similarity: chunk.similarity,
      text: chunk.text || '',
    });
  }

  for (const fileResult of fileMap.values()) {
    fileResult.topChunks.sort((a, b) => b.similarity - a.similarity);
    const top3 = fileResult.topChunks.slice(0, 3);
    fileResult.relevanceScore =
      top3.reduce((sum, chunk) => sum + chunk.similarity, 0) / top3.length;
    fileResult.topChunks = fileResult.topChunks.slice(0, 3);
  }

  return Array.from(fileMap.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
};

/**
 * Shared query service for knowledge base RAG (semantic search + file content
 * retrieval). Used by both the lambda chunk router and the builtin
 * knowledge-base tool server runtime so the orchestration only lives in one
 * place.
 */
export class KnowledgeBaseSearchService {
  private serverDB: LobeChatDatabase;
  private userId: string;
  private chunkModel: ChunkModel;
  private documentModel: DocumentModel;
  private fileModel: FileModel;
  private searchRepo: SearchRepo;
  private documentServiceInstance?: DocumentService;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.serverDB = serverDB;
    this.userId = userId;
    this.chunkModel = new ChunkModel(serverDB, userId);
    this.documentModel = new DocumentModel(serverDB, userId);
    this.fileModel = new FileModel(serverDB, userId);
    this.searchRepo = new SearchRepo(serverDB, userId);
  }

  private get documentService() {
    this.documentServiceInstance ??= new DocumentService(this.serverDB, this.userId);
    return this.documentServiceInstance;
  }

  async semanticSearchForChat(
    input: SemanticSearchSchemaType,
  ): Promise<SemanticSearchForChatResult> {
    const topK = input.topK ?? 20;
    const knowledgeIds = input.knowledgeIds ?? [];

    // Path 1: vector search over file chunks
    const vectorPath = async (): Promise<ChatSemanticSearchChunk[]> => {
      const { model, provider } =
        getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;
      const modelRuntime = await initModelRuntimeFromDB(this.serverDB, this.userId, provider);

      // slice content to make sure in the context window limit
      const query = input.query.length > 8000 ? input.query.slice(0, 8000) : input.query;

      const embeddings = await modelRuntime.embeddings(
        { dimensions: 1024, input: query, model },
        { metadata: { trigger: RequestTrigger.SemanticSearch }, user: this.userId },
      );

      let finalFileIds = input.fileIds ?? [];
      if (knowledgeIds.length > 0) {
        const knowledgeFiles = await this.serverDB.query.knowledgeBaseFiles.findMany({
          where: inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeIds),
        });
        finalFileIds = knowledgeFiles.map((f) => f.fileId).concat(finalFileIds);
      }

      return this.chunkModel.semanticSearchForChat({
        embedding: embeddings![0],
        fileIds: finalFileIds,
        query: input.query,
        topK,
      });
    };

    // Path 2: BM25 search over KB-scoped custom/document documents
    const bm25Path = async (): Promise<KnowledgeBaseDocumentHit[]> => {
      if (knowledgeIds.length === 0) return [];
      return this.searchRepo.searchKnowledgeBaseDocuments(input.query, knowledgeIds, topK);
    };

    const [vectorResult, bm25Result] = await Promise.allSettled([vectorPath(), bm25Path()]);

    const chunks: ChatSemanticSearchChunk[] =
      vectorResult.status === 'fulfilled' ? vectorResult.value : [];
    const documents: KnowledgeBaseDocumentHit[] =
      bm25Result.status === 'fulfilled' ? bm25Result.value : [];

    const errors: { bm25?: string; vector?: string } = {};
    const rejections: { bm25?: unknown; vector?: unknown } = {};

    if (vectorResult.status === 'rejected') {
      const error = vectorResult.reason as any;
      const errorType = error?.errorType;
      errors.vector = error?.message || errorType || 'Vector search failed';
      rejections.vector = error;
      console.error('[KnowledgeBaseSearchService] vector path failed', error);
    }
    if (bm25Result.status === 'rejected') {
      const error = bm25Result.reason as any;
      errors.bm25 = error?.message || 'BM25 search failed';
      rejections.bm25 = error;
      console.error('[KnowledgeBaseSearchService] BM25 path failed', error);
    }

    const fileResults = groupAndRankFiles(chunks, topK);

    return {
      chunks,
      documents,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      fileResults,
      rejections: Object.keys(rejections).length > 0 ? rejections : undefined,
      totalResults: chunks.length + documents.length,
    };
  }

  async getFileContents(ids: string[]): Promise<FileContentResult[]> {
    return pMap(
      ids,
      async (id) => {
        // ---- Branch A: docs_* — read documents.content directly ----
        // KB inline documents (custom/document) have no S3 file.
        if (id.startsWith('docs_')) {
          const doc = await this.documentModel.findById(id);
          if (!doc) {
            return {
              content: '',
              error: 'Document not found',
              fileId: id,
              filename: `Unknown document ${id}`,
            };
          }
          const content = doc.content ?? '';
          const lines = content.split('\n');
          return {
            content,
            fileId: id,
            filename: doc.title || doc.filename || 'Untitled',
            metadata: doc.metadata,
            preview: lines.slice(0, 5).join('\n'),
            totalCharCount: content.length,
            totalLineCount: lines.length,
          };
        }

        // ---- Branch B: file_* — original file/parse path ----
        const file = await this.fileModel.findById(id);
        if (!file) {
          return {
            content: '',
            error: 'File not found',
            fileId: id,
            filename: `Unknown file ${id}`,
          };
        }

        let document: { content: string | null; metadata: Record<string, any> | null } | undefined =
          await this.documentModel.findByFileId(id);

        if (!document) {
          try {
            document = await this.documentService.parseFile(id);
          } catch (error) {
            return {
              content: '',
              error: `Failed to parse file: ${(error as Error).message}`,
              fileId: id,
              filename: file.name,
            };
          }
        }

        const content = document.content || '';
        const lines = content.split('\n');
        return {
          content,
          fileId: id,
          filename: file.name,
          metadata: document.metadata,
          preview: lines.slice(0, 5).join('\n'),
          totalCharCount: content.length,
          totalLineCount: lines.length,
        };
      },
      { concurrency: 3 },
    );
  }
}
