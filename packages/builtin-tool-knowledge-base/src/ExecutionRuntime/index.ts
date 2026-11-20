import {
  formatSearchResults,
  promptFileContents,
  promptNoKnowledgeBaseInScope,
  promptNoSearchResults,
} from '@lobechat/prompts';
import { sliceReadWindow } from '@lobechat/prompts/textWindow';
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
  UpdateDocumentArgs,
  UpdateDocumentState,
  ViewKnowledgeBaseArgs,
  ViewKnowledgeBaseState,
} from '../types';

interface FileContentResult {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  /** Original character count when the stored text was cut at parse time. */
  originalCharCount?: number;
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

interface FileResourceResult {
  createdAt: Date;
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  size: number;
  sourceType: string;
  updatedAt: Date;
  url: string;
}

interface DocumentResult {
  id: string;
}

interface DocumentDetailResult {
  fileType: string;
  id: string;
  knowledgeBaseId?: string | null;
  parentId?: string | null;
  /** `file` = parsed upload, `web` = crawled page; both are derived text, not editable notes. */
  sourceType?: string | null;
  title?: string | null;
}

/** The only document type this tool edits: notes written as text, not parsed uploads. */
const EDITABLE_DOCUMENT_FILE_TYPE = 'custom/document';

/**
 * Parsed uploads are stored as `custom/document` too, so the file type alone
 * cannot tell them from notes; their source type can.
 */
const DERIVED_DOCUMENT_SOURCE_TYPES = new Set(['file', 'web']);

/** Upper bound on the ancestor walk; deeper (or already looping) trees are refused. */
const MAX_PARENT_DEPTH = 64;

interface RagService {
  getFileContents: (fileIds: string[], signal?: AbortSignal) => Promise<FileContentResult[]>;
  semanticSearchForChat: (
    params: { knowledgeIds?: string[]; query: string; topK: number },
    signal?: AbortSignal,
  ) => Promise<{
    chunks: any[];
    documents?: any[];
    errors?: { bm25?: string; vector?: string };
    fileResults: any[];
    /**
     * Knowledge base IDs the search actually covered, when the service
     * resolves the scope itself (server runtime: agent + task project KBs).
     * An empty array means there was nothing to search.
     */
    searchedKnowledgeBaseIds?: string[];
  }>;
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
  /** Resolves only documents the caller can access; `undefined` otherwise. */
  getDocumentById: (id: string) => Promise<DocumentDetailResult | undefined>;
  /** Fields left `undefined` must stay unchanged. */
  updateDocument: (params: {
    content?: string;
    id: string;
    parentId?: string;
    title?: string;
  }) => Promise<DocumentResult>;
}

interface FileService {
  getFileItemById: (id: string) => Promise<FileResourceResult | undefined>;
  getKnowledgeItems: (params: {
    category?: string;
    limit: number;
    offset: number;
    q?: string | null;
    showFilesInKnowledgeBase?: boolean;
  }) => Promise<{ hasMore: boolean; items: FileResourceResult[] }>;
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
    _options?: { signal?: AbortSignal },
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

      const noScopeOutput = (): BuiltinServerRuntimeOutput => ({
        content: promptNoKnowledgeBaseInScope(query),
        state: {
          chunks: [],
          documents: [],
          fileResults: [],
          scope: 'none',
          totalResults: 0,
        } satisfies SearchKnowledgeBaseState,
        success: true,
      });

      // Caller already resolved the scope (client: the agent's enabled KBs)
      // and it is empty — there is nothing to search, and reporting "no
      // relevant files" would make the model believe the content is missing.
      if (options?.knowledgeBaseIds && options.knowledgeBaseIds.length === 0) {
        return noScopeOutput();
      }

      const result = await this.ragService.semanticSearchForChat(
        { knowledgeIds: options?.knowledgeBaseIds, query, topK },
        options?.signal,
      );

      // Service resolved the scope itself (server runtime) and found none.
      if (result.searchedKnowledgeBaseIds && result.searchedKnowledgeBaseIds.length === 0) {
        return noScopeOutput();
      }

      const chunks = result.chunks ?? [];
      const fileResults = result.fileResults ?? [];
      const documents = result.documents ?? [];
      const errors = result.errors;
      const totalResults = chunks.length + documents.length;

      if (totalResults === 0) {
        const state: SearchKnowledgeBaseState = {
          chunks: [],
          documents: [],
          errors,
          fileResults: [],
          totalResults: 0,
        };
        // Surface failure details via formatSearchResults when errors are present
        // so they aren't silently dropped — otherwise fall back to the empty
        // template prompt.
        const content = errors
          ? formatSearchResults(fileResults, query, documents, errors)
          : promptNoSearchResults(query);
        return { content, state, success: true };
      }

      const formattedContent = formatSearchResults(fileResults, query, documents, errors);
      const state: SearchKnowledgeBaseState = {
        chunks,
        documents,
        errors,
        fileResults,
        totalResults,
      };

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
      const { fileIds, limit, offset } = args;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided', success: false };
      }

      const fileContents = await this.ragService.getFileContents(fileIds, options?.signal);

      // Return one bounded window per file rather than the whole document: a
      // whole-file read is the single largest context item in KB conversations
      // and is what pushes tool results past the archive threshold.
      const windows = fileContents.map((file) => {
        if (file.error) return { file, window: undefined };
        return { file, window: sliceReadWindow(file.content, { limit, offset }) };
      });

      const formattedContent = promptFileContents(
        windows.map(({ file, window }) =>
          window
            ? {
                content: window.content,
                fileId: file.fileId,
                filename: file.filename,
                originalChars: file.originalCharCount,
                range: window,
              }
            : {
                content: file.content,
                error: file.error,
                fileId: file.fileId,
                filename: file.filename,
              },
        ),
      );

      const state: ReadKnowledgeState = {
        files: windows.map(({ file, window }) => ({
          endLine: window?.endLine,
          error: file.error,
          fileId: file.fileId,
          filename: file.filename,
          // Preview what this window actually returned, so a paged read shows
          // its own first lines on the card instead of the file head.
          preview: window ? window.content.split('\n').slice(0, 5).join('\n') : file.preview,
          startLine: window?.startLine,
          totalCharCount: file.totalCharCount ?? window?.totalChars,
          totalLineCount: file.totalLineCount ?? window?.totalLines,
          truncated: window?.truncated,
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

  async updateDocument(args: UpdateDocumentArgs): Promise<BuiltinServerRuntimeOutput> {
    try {
      if (!this.documentService) {
        return { content: 'Document service is not available.', success: false };
      }
      // The knowledge base check below is part of the access guard; never skip it.
      if (!this.knowledgeBaseService) {
        return { content: 'Knowledge base service is not available.', success: false };
      }

      const documentId = args.documentId?.trim();
      if (!documentId) {
        return { content: 'Error: documentId is required.', success: false };
      }

      // Models often fill optional fields with "" — that means "leave unchanged",
      // never "erase the body" or "rename to nothing".
      const content = args.content || undefined;
      const title = args.title?.trim() ? args.title.trim() : undefined;
      const parentId = args.parentId?.trim() || undefined;

      if (content === undefined && title === undefined && parentId === undefined) {
        return {
          content: 'Error: Nothing to update. Provide at least one of title, content or parentId.',
          success: false,
        };
      }

      const document = await this.documentService.getDocumentById(documentId);
      if (!document) {
        return {
          content: `Document "${documentId}" not found, or you do not have access to it.`,
          success: false,
        };
      }

      if (!document.knowledgeBaseId) {
        return {
          content: `Document "${documentId}" is not in a knowledge base, so it cannot be edited with this tool.`,
          success: false,
        };
      }

      if (
        document.fileType !== EDITABLE_DOCUMENT_FILE_TYPE ||
        DERIVED_DOCUMENT_SOURCE_TYPES.has(document.sourceType ?? '')
      ) {
        return {
          content: `Document "${documentId}" is an uploaded file or imported web page, not a note, so it cannot be edited. Only documents created as notes (createDocument) can be edited; create a new document instead if needed.`,
          success: false,
        };
      }

      const knowledgeBase = await this.knowledgeBaseService.getKnowledgeBaseById(
        document.knowledgeBaseId,
      );
      if (!knowledgeBase) {
        return {
          content: `Document "${documentId}" belongs to a knowledge base you do not have access to.`,
          success: false,
        };
      }

      if (parentId) {
        if (parentId === documentId) {
          return { content: 'Error: A document cannot be moved under itself.', success: false };
        }
        const parent = await this.documentService.getDocumentById(parentId);
        if (!parent || parent.knowledgeBaseId !== document.knowledgeBaseId) {
          return {
            content: `Parent "${parentId}" not found in knowledge base \`${document.knowledgeBaseId}\`. The new parent must be a folder or document in the same knowledge base.`,
            success: false,
          };
        }

        // Neither the shared write flow nor the model checks ancestry, so a move
        // under one of the document's own descendants would persist a loop: both
        // drop out of the tree and subtree walks never terminate.
        let ancestorId = parent.parentId ?? undefined;
        let depth = 0;
        while (ancestorId) {
          if (ancestorId === documentId) {
            return {
              content: `Error: "${parentId}" is inside document "${documentId}", so the document cannot be moved under it.`,
              success: false,
            };
          }
          if (++depth > MAX_PARENT_DEPTH) {
            return {
              content: `Error: Could not verify where "${parentId}" sits in the knowledge base (nesting is too deep), so the document was not moved.`,
              success: false,
            };
          }
          const ancestor = await this.documentService.getDocumentById(ancestorId);
          ancestorId = ancestor?.parentId ?? undefined;
        }
      }

      const result = await this.documentService.updateDocument({
        content,
        id: documentId,
        parentId,
        title,
      });

      if (!result?.id) {
        return { content: 'Error: Failed to update document.', success: false };
      }

      const changes: string[] = [];
      if (content !== undefined) changes.push(`content replaced (${content.length} characters)`);
      if (title !== undefined) changes.push(`renamed to "${title}"`);
      if (parentId !== undefined) changes.push(`moved under \`${parentId}\``);

      const state: UpdateDocumentState = { id: result.id };

      return {
        content: `Document "${title ?? document.title ?? documentId}" (\`${result.id}\`) updated: ${changes.join('; ')}.`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error updating document: ${(e as Error).message}`,
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
        createdAt: item.createdAt,
        fileType: item.fileType,
        id: item.id,
        name: item.name,
        size: item.size,
        sourceType: item.sourceType,
        url: item.url,
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
        createdAt: item.createdAt,
        fileType: item.fileType,
        id: item.id,
        metadata: item.metadata ?? null,
        name: item.name,
        size: item.size,
        sourceType: item.sourceType,
        updatedAt: item.updatedAt,
        url: item.url,
      };

      const content = [
        `**${file.name}** (ID: \`${file.id}\`)`,
        `- Type: ${file.fileType}`,
        `- Size: ${file.size} bytes`,
        `- Source: ${file.sourceType}`,
        `- Created: ${file.createdAt}`,
        `- Updated: ${file.updatedAt}`,
        `- URL: ${file.url}`,
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
