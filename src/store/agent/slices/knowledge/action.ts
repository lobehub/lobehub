import { type KnowledgeItem } from '@lobechat/types';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';

import type { AgentStore } from '../../store';

const FETCH_AGENT_KNOWLEDGE_KEY = 'FETCH_AGENT_KNOWLEDGE';

/**
 * Knowledge Slice Actions
 * Handles knowledge base and file operations
 */
export interface KnowledgeSliceAction {
  addFilesToAgent: (fileIds: string[], enabled?: boolean) => Promise<void>;
  addKnowledgeBaseToAgent: (knowledgeBaseId: string) => Promise<void>;
  internal_refreshAgentKnowledge: () => Promise<void>;
  removeFileFromAgent: (fileId: string) => Promise<void>;
  removeKnowledgeBaseFromAgent: (knowledgeBaseId: string) => Promise<void>;
  toggleFile: (id: string, open?: boolean) => Promise<void>;
  toggleKnowledgeBase: (id: string, open?: boolean) => Promise<void>;
  useFetchFilesAndKnowledgeBases: (agentId?: string) => SWRResponse<KnowledgeItem[]>;
}

export const createKnowledgeSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeSliceAction
> = (set, get) => ({
  addFilesToAgent: async (fileIds, enabled) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;
    if (fileIds.length === 0) return;

    await agentService.createAgentFiles(activeAgentId, fileIds, enabled);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  },

  addKnowledgeBaseToAgent: async (knowledgeBaseId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.createAgentKnowledgeBase(activeAgentId, knowledgeBaseId, true);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  },

  internal_refreshAgentKnowledge: async () => {
    await mutate([FETCH_AGENT_KNOWLEDGE_KEY, get().activeAgentId]);
  },

  removeFileFromAgent: async (fileId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.deleteAgentFile(activeAgentId, fileId);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  },

  removeKnowledgeBaseFromAgent: async (knowledgeBaseId) => {
    const { activeAgentId, internal_refreshAgentConfig, internal_refreshAgentKnowledge } = get();
    if (!activeAgentId) return;

    await agentService.deleteAgentKnowledgeBase(activeAgentId, knowledgeBaseId);
    await internal_refreshAgentConfig(activeAgentId);
    await internal_refreshAgentKnowledge();
  },

  toggleFile: async (id, open) => {
    const { activeAgentId, internal_refreshAgentConfig } = get();
    if (!activeAgentId) return;

    await agentService.toggleFile(activeAgentId, id, open);
    await internal_refreshAgentConfig(activeAgentId);
  },

  toggleKnowledgeBase: async (id, open) => {
    const { activeAgentId, internal_refreshAgentConfig } = get();
    if (!activeAgentId) return;

    await agentService.toggleKnowledgeBase(activeAgentId, id, open);
    await internal_refreshAgentConfig(activeAgentId);
  },

  useFetchFilesAndKnowledgeBases: (agentId) => {
    return useClientDataSWR<KnowledgeItem[]>(
      agentId ? [FETCH_AGENT_KNOWLEDGE_KEY, agentId] : null,
      ([, id]: string[]) => agentService.getFilesAndKnowledgeBases(id),
      {
        fallbackData: [],
      },
    );
  },
});
