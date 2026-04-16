import { formatSearchResults, promptFileContents, promptNoSearchResults } from '@lobechat/prompts';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  AddFilesArgs,
  CreateDocumentArgs,
  CreateDocumentState,
  CreateKnowledgeBaseArgs,
  CreateKnowledgeBaseState,
  DeleteKnowledgeBaseArgs,
  FileDetail,
  FileInfo,
  GetFileDetailArgs,
  GetFileDetailState,
  KnowledgeBaseFileInfo,
  KnowledgeBaseInfo,
  ListFilesArgs,
  ListFilesState,
  ListKnowledgeBasesState,
  ReadKnowledgeArgs,
  ReadKnowledgeState,
  RemoveFilesArgs,
  SearchKnowledgeBaseArgs,
  SearchKnowledgeBaseState,
  ViewKnowledgeBaseArgs,
  ViewKnowledgeBaseState,
} from '../types';

interface FileContentResult {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  preview?: string;
  totalCharCount?: number;
  totalLineCount?: number;
}

interface KnowledgeBaseItemResult {
  avatar: string | null;
  description?: string | null;
  id: string;
  name: string;
  updatedAt: Date;
}

interface FileListItemResult {
  fileType: string;
  id: string;
  name: string;
  size: number;
  sourceType: string;
  updatedAt: Date;
}

interface DocumentResult {
  id: string;
}

interface RagService {
  getFileContents: (fileIds: string[], signal?: AbortSignal) => Promise<FileContentResult[]>;
  semanticSearchForChat: (
    params: { knowledgeIds?: string[]; query: string; topK: number },
    signal?: AbortSignal,
  ) => Promise<{ chunks: any[]; fileResults: any[] }>;
}

interface KnowledgeBaseService {
  addFilesToKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<any>;
  createKnowledgeBase: (params: { description?: string; name: string }) => Promise<string>;
  getKnowledgeBaseById: (id: string) => Promise<KnowledgeBaseItemResult | undefined>;
  getKnowledgeBases: () => Promise<KnowledgeBaseItemResult[]>;
  getKnowledgeItems: (params: {
    knowledgeBaseId: string;
    limit: number;
    offset: number;
  }) => Promise<{ hasMore: boolean; items: FileListItemResult[] }>;
  removeFilesFromKnowledgeBase: (knowledgeBaseId: string, ids: string[]) => Promise<any>;
  removeKnowledgeBase: (id: string) => Promise<void>;
}

interface DocumentService {
  createDocument: (params: {
    content?: string;
    fileType?: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
  }) => Promise<DocumentResult>;
}

interface FileService {
  getFileItemById: (id: string) => Promise<FileListItemResult | undefined>;
  getKnowledgeItems: (params: {
    category?: string;
    limit: number;
    offset: number;
    q?: string | null;
    showFilesInKnowledgeBase?: boolean;
  }) => Promise<{ hasMore: boolean; items: FileListItemResult[] }>;
}

export class KnowledgeBaseExecutionRuntime {
  private documentService?: DocumentService;
  private fileService?: FileService;
  private knowledgeBaseService?: KnowledgeBaseService;
  private ragService: RagService;

  constructor(
    ragService: RagService,
    knowledgeBaseService?: KnowledgeBaseService,
    documentService?: DocumentService,
    fileService?: FileService,
  ) {
    this.ragService = ragService;
    this.knowledgeBaseService = knowledgeBaseService;
    this.documentService = documentService;
    this.fileService = fileService;
  }

  // ============ P0: Visibility ============

  async listKnowledgeBases(): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const knowledgeBases = await this.knowledgeBaseService.getKnowledgeBases();

      if (knowledgeBases.length === 0) {
        return {
          content:
            'No knowledge bases found. You can create one using the createKnowledgeBase tool.',
          state: { knowledgeBases: [], total: 0 } satisfies ListKnowledgeBasesState,
          success: true,
        };
      }

      const items: KnowledgeBaseInfo[] = knowledgeBases.map((kb) => ({
        avatar: kb.avatar,
        description: kb.description,
        id: kb.id,
        name: kb.name,
        updatedAt: kb.updatedAt,
      }));

      const lines = items.map(
        (kb) =>
          `- **${kb.name}** (ID: \`${kb.id}\`)${kb.description ? ` — ${kb.description}` : ''}`,
      );

      const state: ListKnowledgeBasesState = { knowledgeBases: items, total: items.length };

      return {
        content: `Found ${items.length} knowledge base(s):\n\n${lines.join('\n')}`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error listing knowledge bases: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async viewKnowledgeBase(
    args: ViewKnowledgeBaseArgs,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const { id, limit = 50, offset = 0 } = args;
      const cappedLimit = Math.min(limit, 100);

      const knowledgeBase = await this.knowledgeBaseService.getKnowledgeBaseById(id);

      if (!knowledgeBase) {
        return { content: `Knowledge base with ID "${id}" not found.`, success: false };
      }

      const result = await this.knowledgeBaseService.getKnowledgeItems({
        knowledgeBaseId: id,
        limit: cappedLimit,
        offset,
      });

      const items: KnowledgeBaseFileInfo[] = result.items.map((item) => ({
        fileType: item.fileType,
        id: item.id,
        name: item.name,
        size: item.size,
        sourceType: item.sourceType,
        updatedAt: item.updatedAt,
      }));

      const kbInfo: KnowledgeBaseInfo = {
        avatar: knowledgeBase.avatar,
        description: knowledgeBase.description,
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        updatedAt: knowledgeBase.updatedAt,
      };

      let content = `**${knowledgeBase.name}** (ID: \`${knowledgeBase.id}\`)`;
      if (knowledgeBase.description) content += `\nDescription: ${knowledgeBase.description}`;
      content += `\n\nShowing ${items.length} item(s) (offset: ${offset}):`;

      if (items.length > 0) {
        const fileLines = items.map(
          (f) => `- \`${f.id}\` | ${f.sourceType} | ${f.name} | ${f.fileType} | ${f.size} bytes`,
        );
        content += '\n\n' + fileLines.join('\n');
      }

      if (result.hasMore) {
        content += `\n\n_More items available. Use offset=${offset + cappedLimit} to see the next page._`;
      }

      const state: ViewKnowledgeBaseState = {
        files: items,
        hasMore: result.hasMore,
        knowledgeBase: kbInfo,
        total: items.length,
      };

      return { content, state, success: true };
    } catch (e) {
      return {
        content: `Error viewing knowledge base: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  // ============ Search & Read ============

  async searchKnowledgeBase(
    args: SearchKnowledgeBaseArgs,
    options?: {
      knowledgeBaseIds?: string[];
      messageId?: string;
      signal?: AbortSignal;
    },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { query, topK = 20 } = args;

      const { chunks, fileResults } = await this.ragService.semanticSearchForChat(
        { knowledgeIds: options?.knowledgeBaseIds, query, topK },
        options?.signal,
      );

      if (chunks.length === 0) {
        const state: SearchKnowledgeBaseState = { chunks: [], fileResults: [], totalResults: 0 };
        return { content: promptNoSearchResults(query), state, success: true };
      }

      const formattedContent = formatSearchResults(fileResults, query);
      const state: SearchKnowledgeBaseState = { chunks, fileResults, totalResults: chunks.length };

      return { content: formattedContent, state, success: true };
    } catch (e) {
      return {
        content: `Error searching knowledge base: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async readKnowledge(
    args: ReadKnowledgeArgs,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { fileIds } = args;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided', success: false };
      }

      const fileContents = await this.ragService.getFileContents(fileIds, options?.signal);
      const formattedContent = promptFileContents(fileContents);

      const state: ReadKnowledgeState = {
        files: fileContents.map((file) => ({
          error: file.error,
          fileId: file.fileId,
          filename: file.filename,
          preview: file.preview,
          totalCharCount: file.totalCharCount,
          totalLineCount: file.totalLineCount,
        })),
      };

      return { content: formattedContent, state, success: true };
    } catch (e) {
      return {
        content: `Error reading knowledge: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  // ============ P1: Management ============

  async createKnowledgeBase(args: CreateKnowledgeBaseArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const { name, description } = args;
      const id = await this.knowledgeBaseService.createKnowledgeBase({ description, name });

      if (!id) {
        return { content: 'Error: Failed to create knowledge base.', success: false };
      }

      const state: CreateKnowledgeBaseState = { id };

      return {
        content: `Knowledge base "${name}" created successfully. ID: \`${id}\``,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error creating knowledge base: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async deleteKnowledgeBase(args: DeleteKnowledgeBaseArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      await this.knowledgeBaseService.removeKnowledgeBase(args.id);

      return {
        content: `Knowledge base \`${args.id}\` deleted successfully.`,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error deleting knowledge base: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async createDocument(args: CreateDocumentArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.documentService) {
        return { content: 'Document service is not available.', success: false };
      }

      const { knowledgeBaseId, title, content, parentId } = args;

      const result = await this.documentService.createDocument({
        content,
        fileType: 'custom/document',
        knowledgeBaseId,
        parentId,
        title,
      });

      if (!result?.id) {
        return { content: 'Error: Failed to create document.', success: false };
      }

      const state: CreateDocumentState = { id: result.id };

      return {
        content: `Document "${title}" created successfully in knowledge base \`${knowledgeBaseId}\`. Document ID: \`${result.id}\``,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error creating document: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async addFiles(args: AddFilesArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const { knowledgeBaseId, fileIds } = args;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided.', success: false };
      }

      await this.knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);

      return {
        content: `Successfully added ${fileIds.length} file(s) to knowledge base \`${knowledgeBaseId}\`.`,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error adding files: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async removeFiles(args: RemoveFilesArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const { knowledgeBaseId, fileIds } = args;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided.', success: false };
      }

      await this.knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, fileIds);

      return {
        content: `Successfully removed ${fileIds.length} file(s) from knowledge base \`${knowledgeBaseId}\`.`,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error removing files: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  // ============ Resource Library Files ============

  async listFiles(args: ListFilesArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.fileService) {
        return { content: 'File service is not available.', success: false };
      }

      const { category, q, limit = 50, offset = 0 } = args;

      const result = await this.fileService.getKnowledgeItems({
        category,
        limit,
        offset,
        q,
        showFilesInKnowledgeBase: false,
      });

      const files: FileInfo[] = result.items.map((item) => ({
        createdAt: item.updatedAt,
        fileType: item.fileType,
        id: item.id,
        name: item.name,
        size: item.size,
        sourceType: item.sourceType,
        url: '',
      }));

      if (files.length === 0) {
        const msg = category
          ? `No ${category} files found in your resource library.`
          : 'No files found in your resource library.';
        return {
          content: msg,
          state: { files: [], hasMore: false, total: 0 } satisfies ListFilesState,
          success: true,
        };
      }

      const lines = files.map((f) => `- \`${f.id}\` | ${f.name} | ${f.fileType} | ${f.size} bytes`);

      let content = `Found ${files.length} file(s)`;
      if (category) content += ` in category "${category}"`;
      if (result.hasMore) content += ` (more available, use offset=${offset + limit} to paginate)`;
      content += `:\n\n${lines.join('\n')}`;

      const state: ListFilesState = { files, hasMore: result.hasMore, total: files.length };

      return { content, state, success: true };
    } catch (e) {
      return {
        content: `Error listing files: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }

  async getFileDetail(args: GetFileDetailArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.fileService) {
        return { content: 'File service is not available.', success: false };
      }

      const { id } = args;
      const item = await this.fileService.getFileItemById(id);

      if (!item) {
        return { content: `File with ID "${id}" not found.`, success: false };
      }

      const file: FileDetail = {
        createdAt: item.updatedAt,
        fileType: item.fileType,
        id: item.id,
        metadata: null,
        name: item.name,
        size: item.size,
        sourceType: item.sourceType,
        updatedAt: item.updatedAt,
        url: '',
      };

      const content = [
        `**${file.name}** (ID: \`${file.id}\`)`,
        `- Type: ${file.fileType}`,
        `- Size: ${file.size} bytes`,
        `- Source: ${file.sourceType}`,
        `- Updated: ${file.updatedAt}`,
      ].join('\n');

      const state: GetFileDetailState = { file };

      return { content, state, success: true };
    } catch (e) {
      return {
        content: `Error getting file detail: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }
}
