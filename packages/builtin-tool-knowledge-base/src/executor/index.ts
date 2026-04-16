import { formatSearchResults, promptFileContents, promptNoSearchResults } from '@lobechat/prompts';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { ragService } from '@/services/rag';
import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';

import type {
  AddFilesArgs,
  CreateDocumentArgs,
  CreateDocumentState,
  CreateKnowledgeBaseArgs,
  CreateKnowledgeBaseState,
  DeleteKnowledgeBaseArgs,
  FileContentDetail,
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
import { KnowledgeBaseApiName, KnowledgeBaseIdentifier } from '../types';

class KnowledgeBaseExecutor extends BaseExecutor<typeof KnowledgeBaseApiName> {
  readonly identifier = KnowledgeBaseIdentifier;
  protected readonly apiEnum = KnowledgeBaseApiName;

  // ============ P0: Visibility ============

  listKnowledgeBases = async (): Promise<BuiltinToolResult> => {
    try {
      const knowledgeBases = await lambdaClient.knowledgeBase.getKnowledgeBases.query();

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

      const content = `Found ${items.length} knowledge base(s):\n\n${lines.join('\n')}`;

      const state: ListKnowledgeBasesState = { knowledgeBases: items, total: items.length };

      return { content, state, success: true };
    } catch (e) {
      return {
        content: `Error listing knowledge bases: ${(e as Error).message}`,
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  viewKnowledgeBase = async (params: ViewKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    try {
      const { id, limit = 50, offset = 0 } = params;
      const cappedLimit = Math.min(limit, 100);

      const knowledgeBase = await lambdaClient.knowledgeBase.getKnowledgeBaseById.query({ id });

      if (!knowledgeBase) {
        return { content: `Knowledge base with ID "${id}" not found.`, success: false };
      }

      const result = await lambdaClient.file.getKnowledgeItems.query({
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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ============ Search & Read ============

  searchKnowledgeBase = async (
    params: SearchKnowledgeBaseArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const { query, topK = 20 } = params;

      const agentState = getAgentStoreState();
      const knowledgeIds = agentSelectors.currentKnowledgeIds(agentState);
      const knowledgeBaseIds = knowledgeIds.knowledgeBaseIds;

      const { chunks, fileResults } = await ragService.semanticSearchForChat(
        { knowledgeIds: knowledgeBaseIds, query, topK },
        ctx.signal,
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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  readKnowledge = async (params: ReadKnowledgeArgs): Promise<BuiltinToolResult> => {
    try {
      const { fileIds } = params;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided', success: false };
      }

      const fileContents = await ragService.getFileContents(fileIds);
      const formattedContent = promptFileContents(fileContents);

      const state: ReadKnowledgeState = {
        files: fileContents.map(
          (file): FileContentDetail => ({
            error: file.error,
            fileId: file.fileId,
            filename: file.filename,
            preview: file.preview,
            totalCharCount: file.totalCharCount,
            totalLineCount: file.totalLineCount,
          }),
        ),
      };

      return { content: formattedContent, state, success: true };
    } catch (e) {
      return {
        content: `Error reading knowledge: ${(e as Error).message}`,
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ============ P1: Management ============

  createKnowledgeBase = async (params: CreateKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    try {
      const { name, description } = params;

      const id = await lambdaClient.knowledgeBase.createKnowledgeBase.mutate({
        description,
        name,
      });

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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  deleteKnowledgeBase = async (params: DeleteKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    try {
      const { id } = params;

      await lambdaClient.knowledgeBase.removeKnowledgeBase.mutate({ id });

      return {
        content: `Knowledge base \`${id}\` deleted successfully.`,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error deleting knowledge base: ${(e as Error).message}`,
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  createDocument = async (params: CreateDocumentArgs): Promise<BuiltinToolResult> => {
    try {
      const { knowledgeBaseId, title, content, parentId } = params;

      const result = await lambdaClient.document.createDocument.mutate({
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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  addFiles = async (params: AddFilesArgs): Promise<BuiltinToolResult> => {
    try {
      const { knowledgeBaseId, fileIds } = params;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided.', success: false };
      }

      await lambdaClient.knowledgeBase.addFilesToKnowledgeBase.mutate({
        ids: fileIds,
        knowledgeBaseId,
      });

      return {
        content: `Successfully added ${fileIds.length} file(s) to knowledge base \`${knowledgeBaseId}\`.`,
        success: true,
      };
    } catch (e: any) {
      const pgErrorCode = e?.cause?.cause?.code || e?.cause?.code || e?.code;
      if (pgErrorCode === '23505') {
        return {
          content: 'Error: One or more files are already in this knowledge base.',
          success: false,
        };
      }

      return {
        content: `Error adding files: ${(e as Error).message}`,
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  removeFiles = async (params: RemoveFilesArgs): Promise<BuiltinToolResult> => {
    try {
      const { knowledgeBaseId, fileIds } = params;

      if (!fileIds || fileIds.length === 0) {
        return { content: 'Error: No file IDs provided.', success: false };
      }

      await lambdaClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate({
        ids: fileIds,
        knowledgeBaseId,
      });

      return {
        content: `Successfully removed ${fileIds.length} file(s) from knowledge base \`${knowledgeBaseId}\`.`,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error removing files: ${(e as Error).message}`,
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ============ Resource Library Files ============

  listFiles = async (params: ListFilesArgs): Promise<BuiltinToolResult> => {
    try {
      const { category, q, limit = 50, offset = 0 } = params;

      const result = await lambdaClient.file.getKnowledgeItems.query({
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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  getFileDetail = async (params: GetFileDetailArgs): Promise<BuiltinToolResult> => {
    try {
      const { id } = params;

      const item = await lambdaClient.file.getFileItemById.query({ id });

      if (!item) {
        return { content: `File with ID "${id}" not found.`, success: false };
      }

      const file: FileDetail = {
        createdAt: item.createdAt,
        fileType: item.fileType,
        id: item.id,
        metadata: item.metadata,
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
        error: { body: e, message: (e as Error).message, type: 'PluginServerError' },
        success: false,
      };
    }
  };
}

export const knowledgeBaseExecutor = new KnowledgeBaseExecutor();
