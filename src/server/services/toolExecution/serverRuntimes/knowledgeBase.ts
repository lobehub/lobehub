import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { KnowledgeBaseExecutionRuntime } from '@lobechat/builtin-tool-knowledge-base/executionRuntime';

import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { appEnv } from '@/envs/app';
import { DocumentService } from '@/server/services/document';
import { KnowledgeBaseSearchService } from '@/server/services/knowledgeBase';

import { type ServerRuntimeRegistration } from './types';

const getFileProxyUrl = (fileId: string): string => `${appEnv.APP_URL}/f/${fileId}`;

export const knowledgeBaseRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, agentId } = context;
    if (!userId || !serverDB) {
      throw new Error('userId and serverDB are required for Knowledge Base execution');
    }

    const fileModel = new FileModel(serverDB, userId);
    const knowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId);
    const knowledgeRepo = new KnowledgeRepo(serverDB, userId);
    const documentService = new DocumentService(serverDB, userId);
    const searchService = new KnowledgeBaseSearchService(serverDB, userId);
    const agentModel = agentId ? new AgentModel(serverDB, userId) : null;

    const resolveAgentKnowledgeBaseIds = async (override?: string[]): Promise<string[]> => {
      if (override && override.length > 0) return override;
      if (!agentModel || !agentId) return [];
      const knowledge = await agentModel.getAgentAssignedKnowledge(agentId);
      return knowledge.knowledgeBases.filter((k) => k.enabled && k.id).map((k) => k.id as string);
    };

    return new KnowledgeBaseExecutionRuntime(
      {
        getFileContents: (fileIds) => searchService.getFileContents(fileIds),
        semanticSearchForChat: async ({ knowledgeIds, query, topK }) => {
          const effectiveKnowledgeIds = await resolveAgentKnowledgeBaseIds(knowledgeIds);
          const result = await searchService.semanticSearchForChat({
            knowledgeIds: effectiveKnowledgeIds,
            query,
            topK,
          });
          return {
            chunks: result.chunks,
            documents: result.documents,
            errors: result.errors,
            fileResults: result.fileResults,
          };
        },
      },
      {
        addFilesToKnowledgeBase: async (knowledgeBaseId, ids) => {
          try {
            return await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, ids);
          } catch (e: any) {
            // PG unique-constraint violation on (knowledge_base_id, file_id).
            // Re-throw with a friendly message so the ExecutionRuntime's
            // generic catch surfaces it directly.
            if (e?.cause?.code === '23505' || e?.code === '23505') {
              throw new Error('One or more files are already in this knowledge base.', {
                cause: e,
              });
            }
            throw e;
          }
        },
        createKnowledgeBase: async ({ description, name }) => {
          const data = await knowledgeBaseModel.create({ description, name });
          return data?.id ?? '';
        },
        getKnowledgeBaseById: async (id) => {
          const item = await knowledgeBaseModel.findById(id);
          if (!item) return undefined;
          return {
            avatar: item.avatar ?? null,
            description: item.description,
            id: item.id,
            name: item.name,
            updatedAt: item.updatedAt,
          };
        },
        getKnowledgeBases: async () => {
          const items = await knowledgeBaseModel.query();
          return items.map((kb) => ({
            avatar: kb.avatar ?? null,
            description: kb.description,
            id: kb.id,
            name: kb.name,
            updatedAt: kb.updatedAt,
          }));
        },
        getKnowledgeItems: async ({ knowledgeBaseId, limit, offset }) => {
          const items = await knowledgeRepo.query({
            knowledgeBaseId,
            limit: limit + 1,
            offset,
          });
          const hasMore = items.length > limit;
          const slice = hasMore ? items.slice(0, limit) : items;
          return {
            hasMore,
            items: slice.map((item) => ({
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
          knowledgeBaseModel.removeFilesFromKnowledgeBase(knowledgeBaseId, ids),
        removeKnowledgeBase: async (id) => {
          await knowledgeBaseModel.deleteWithFiles(id);
        },
      },
      {
        createDocument: async ({ content, fileType, knowledgeBaseId, parentId, title }) => {
          const doc = await documentService.createDocument({
            content,
            editorData: {},
            fileType,
            knowledgeBaseId,
            parentId,
            title,
          });
          return { id: doc.id };
        },
      },
      {
        getFileItemById: async (id) => {
          const item = await fileModel.findById(id);
          if (!item) return undefined;
          return {
            createdAt: item.createdAt,
            fileType: item.fileType,
            id: item.id,
            metadata: (item.metadata as Record<string, any> | null) ?? null,
            name: item.name,
            size: item.size,
            sourceType: 'file',
            updatedAt: item.updatedAt,
            url: getFileProxyUrl(item.id),
          };
        },
        getKnowledgeItems: async ({ category, limit, offset, q, showFilesInKnowledgeBase }) => {
          const items = await knowledgeRepo.query({
            category,
            limit: limit + 1,
            offset,
            q,
            showFilesInKnowledgeBase,
          });
          const hasMore = items.length > limit;
          const slice = hasMore ? items.slice(0, limit) : items;
          return {
            hasMore,
            items: slice.map((item) => ({
              createdAt: item.createdAt,
              fileType: item.fileType,
              id: item.id,
              metadata: item.metadata ?? null,
              name: item.name,
              size: item.size,
              sourceType: item.sourceType,
              updatedAt: item.updatedAt,
              url:
                item.sourceType === 'file'
                  ? getFileProxyUrl(item.fileId || item.id)
                  : item.url || '',
            })),
          };
        },
      },
    );
  },
  identifier: KnowledgeBaseIdentifier,
};
