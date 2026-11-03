import type {
  BuiltinServerRuntimeOutput,
  BuiltinToolContext,
  BuiltinToolResult,
} from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { ragService } from '@/services/rag';
import { agentSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';

import { KnowledgeBaseExecutionRuntime } from '../../ExecutionRuntime';
import type {
  AddFilesArgs,
  CreateDocumentArgs,
  CreateKnowledgeBaseArgs,
  DeleteKnowledgeBaseArgs,
  GetFileDetailArgs,
  ListFilesArgs,
  ReadKnowledgeArgs,
  RemoveFilesArgs,
  SearchKnowledgeBaseArgs,
  ViewKnowledgeBaseArgs,
} from '../../types';
import { KnowledgeBaseApiName, KnowledgeBaseIdentifier } from '../../types';

class KnowledgeBaseExecutor extends BaseExecutor<typeof KnowledgeBaseApiName> {
  readonly identifier = KnowledgeBaseIdentifier;
  protected readonly apiEnum = KnowledgeBaseApiName;

  private runtime = new KnowledgeBaseExecutionRuntime(
    {
      getFileContents: (fileIds, signal) => ragService.getFileContents(fileIds, signal),
      semanticSearchForChat: (params, signal) => ragService.semanticSearchForChat(params, signal),
    },
    {
      addFilesToKnowledgeBase: async (knowledgeBaseId, ids) => {
        try {
          return await lambdaClient.knowledgeBase.addFilesToKnowledgeBase.mutate({
            ids,
            knowledgeBaseId,
          });
        } catch (e: any) {
          // Lambda router emits TRPCError(CONFLICT, 'FILE_ALREADY_IN_KNOWLEDGE_BASE')
          // as an i18n sentinel for resource-manager UI. Translate it to a
          // human-readable message for the agent.
          if (e?.data?.code === 'CONFLICT' || e?.message === 'FILE_ALREADY_IN_KNOWLEDGE_BASE') {
            throw new Error('One or more files are already in this knowledge base.', { cause: e });
          }
          throw e;
        }
      },
      createKnowledgeBase: (params) =>
        lambdaClient.knowledgeBase.createKnowledgeBase.mutate(params),
      getKnowledgeBaseById: async (id) => {
        const kb = await lambdaClient.knowledgeBase.getKnowledgeBaseById.query({ id });
        if (!kb) return undefined;
        return {
          avatar: kb.avatar,
          description: kb.description,
          id: kb.id,
          name: kb.name,
          updatedAt: kb.updatedAt,
        };
      },
      getKnowledgeBases: async () => {
        const items = await lambdaClient.knowledgeBase.getKnowledgeBases.query();
        return items.map((kb) => ({
          avatar: kb.avatar,
          description: kb.description,
          id: kb.id,
          name: kb.name,
          updatedAt: kb.updatedAt,
        }));
      },
      getKnowledgeItems: async ({ knowledgeBaseId, limit, offset }) => {
        const result = await lambdaClient.file.getKnowledgeItems.query({
          knowledgeBaseId,
          limit,
          offset,
        });
        return {
          hasMore: result.hasMore,
          items: result.items.map((item) => ({
            fileType: item.fileType,
            id: item.id,
            name: item.name,
            size: item.size,
            sourceType: item.sourceType,
            updatedAt: item.updatedAt,
          })),
        };
      },
      removeFilesFromKnowledgeBase: (knowledgeBaseId, ids) =>
        lambdaClient.knowledgeBase.removeFilesFromKnowledgeBase.mutate({ ids, knowledgeBaseId }),
      removeKnowledgeBase: async (id) => {
        await lambdaClient.knowledgeBase.removeKnowledgeBase.mutate({ id });
      },
    },
    {
      createDocument: async (params) => {
        const doc = await lambdaClient.document.createDocument.mutate(params);
        return { id: doc.id };
      },
    },
    {
      getFileItemById: async (id) => {
        const item = await lambdaClient.file.getFileItemById.query({ id });
        if (!item) return undefined;
        return {
          createdAt: item.createdAt,
          fileType: item.fileType,
          id: item.id,
          metadata: item.metadata,
          name: item.name,
          size: item.size,
          sourceType: 'file',
          updatedAt: item.updatedAt,
          url: item.url,
        };
      },
      getKnowledgeItems: async (params) => {
        const result = await lambdaClient.file.getKnowledgeItems.query(params);
        return {
          hasMore: result.hasMore,
          items: result.items.map((item) => ({
            createdAt: item.createdAt,
            fileType: item.fileType,
            id: item.id,
            metadata: item.metadata,
            name: item.name,
            size: item.size,
            sourceType: item.sourceType,
            updatedAt: item.updatedAt,
            url: item.url ?? '',
          })),
        };
      },
    },
  );

  /**
   * Convert BuiltinServerRuntimeOutput → BuiltinToolResult.
   * Single funnel to enforce that `content` is never undefined and `state` is
   * preserved on failure so renderers can still display partial output.
   */
  private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errorMessage =
      typeof output.error?.message === 'string' ? output.error.message : undefined;
    const safeContent = output.content || errorMessage || 'Tool execution failed';

    if (!output.success) {
      return {
        content: safeContent,
        error: output.error
          ? { body: output.error, message: errorMessage ?? safeContent, type: 'PluginServerError' }
          : undefined,
        state: output.state,
        success: false,
      };
    }
    return { content: safeContent, state: output.state, success: true };
  }

  // ============ P0: Visibility ============

  listKnowledgeBases = async (): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.listKnowledgeBases());
  };

  viewKnowledgeBase = async (params: ViewKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.viewKnowledgeBase(params));
  };

  // ============ Search & Read ============

  searchKnowledgeBase = async (
    params: SearchKnowledgeBaseArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { knowledgeBaseIds } = agentSelectors.currentKnowledgeIds(getAgentStoreState());
    return this.toResult(
      await this.runtime.searchKnowledgeBase(params, {
        knowledgeBaseIds,
        messageId: ctx.messageId,
        signal: ctx.signal,
      }),
    );
  };

  readKnowledge = async (
    params: ReadKnowledgeArgs,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.readKnowledge(params, { signal: ctx.signal }));
  };

  // ============ P1: Management ============

  createKnowledgeBase = async (params: CreateKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.createKnowledgeBase(params));
  };

  deleteKnowledgeBase = async (params: DeleteKnowledgeBaseArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.deleteKnowledgeBase(params));
  };

  createDocument = async (params: CreateDocumentArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.createDocument(params));
  };

  addFiles = async (params: AddFilesArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.addFiles(params));
  };

  removeFiles = async (params: RemoveFilesArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.removeFiles(params));
  };

  // ============ Resource Library Files ============

  listFiles = async (params: ListFilesArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.listFiles(params));
  };

  getFileDetail = async (params: GetFileDetailArgs): Promise<BuiltinToolResult> => {
    return this.toResult(await this.runtime.getFileDetail(params));
  };
}

export const knowledgeBaseExecutor = new KnowledgeBaseExecutor();
