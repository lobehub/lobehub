import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { type AgentContextDocument } from '@lobechat/context-engine';

import { lambdaClient, withLlmRelay } from '@/libs/trpc/client';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { oneShotRelay } from '@/services/llmRelay';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';

export { agentDocumentSWRKeys } from '@/services/document/swrKeys';

const revalidateAgentDocuments = async (agentId: string) => {
  await invalidateDocumentMutation({ agentId, cause: 'agent-document' });
};

const getStringField = (value: unknown, field: 'documentId' | 'id') => {
  if (!value || typeof value !== 'object' || !(field in value)) return undefined;

  const fieldValue = (value as Record<string, unknown>)[field];

  return typeof fieldValue === 'string' ? fieldValue : undefined;
};

const getDocumentId = (value: unknown) => getStringField(value, 'documentId');

interface AgentDocumentToolContext {
  messageId: string;
  operationId?: string;
  rootOperationId?: string;
  taskId?: string | null;
  threadId?: string | null;
  toolCallId: string;
  toolMessageId?: string;
  topicId?: string;
}

interface AgentDocumentToolTriggerInput {
  toolContext?: AgentDocumentToolContext;
  trigger?: 'tool';
}

class AgentDocumentService {
  getTemplates = async () => {
    return lambdaClient.agentDocument.getTemplates.query();
  };

  getDocuments = async (params: { agentId: string }) => {
    return lambdaClient.agentDocument.getDocuments.query(params);
  };

  getContextDocuments = async (params: { agentId: string }) => {
    return lambdaClient.agentDocument.getContextDocuments.query(params);
  };

  initializeFromTemplate = async (params: { agentId: string; templateSet: string }) => {
    const result = await lambdaClient.agentDocument.initializeFromTemplate.mutate(params);
    await revalidateAgentDocuments(params.agentId);

    return result;
  };

  listDocuments = async (params: {
    agentId: string;
    excludeWeb?: boolean;
    includeArchivedToolResults?: boolean;
    parentId?: string;
    scope?: 'agent' | 'currentTopic';
    sourceType?: 'all' | 'file' | 'web';
    topicId?: string;
    withChildCount?: boolean;
  }) => {
    return lambdaClient.agentDocument.listDocuments.query(params);
  };

  getOrCreateChatTopic = async (params: { agentId: string; documentId: string }) => {
    return lambdaClient.agentDocument.getOrCreateChatTopic.mutate(params);
  };

  getReaderDocument = async (params: { agentId: string; documentId: string }) => {
    return lambdaClient.agentDocument.getReaderDocument.query(params);
  };

  /** A managed skill and its `SKILL.md`; `null` once it no longer exists. */
  getSkill = async (params: { agentDocumentId: string; agentId: string }) => {
    return lambdaClient.agentDocument.getSkill.query(params);
  };

  associateDocument = async (params: { agentId: string; documentId: string }) => {
    const result = await lambdaClient.agentDocument.associateDocument.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: params.documentId,
    });

    return result;
  };

  importFile = async (params: { agentId: string; fileId: string; parentId?: string | null }) => {
    const result = await lambdaClient.agentDocument.importFile.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  createDocument = async (
    params: {
      agentId: string;
      content: string;
      hintIsSkill?: boolean;
      parentId?: string;
      title: string;
    } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.createDocument.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  createForTopic = async (
    params: {
      agentId: string;
      content: string;
      hintIsSkill?: boolean;
      parentId?: string;
      title: string;
      topicId: string;
    } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.createForTopic.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
      topicId: params.topicId,
    });

    return result;
  };

  readDocument = async (params: {
    agentId: string;
    format?: 'xml' | 'markdown' | 'both';
    id: string;
  }) => {
    return lambdaClient.agentDocument.readDocument.query(params);
  };

  replaceDocumentContent = async (
    params: { agentId: string; content: string; id: string } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.replaceDocumentContent.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  modifyNodes = async (
    params: {
      agentId: string;
      id: string;
      operations: Array<
        | {
            action: 'insert';
            afterId: string;
            litexml: string;
          }
        | {
            action: 'insert';
            beforeId: string;
            litexml: string;
          }
        | {
            action: 'modify';
            litexml: string | string[];
          }
        | {
            action: 'remove';
            id: string;
          }
      >;
    } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.modifyNodes.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  removeDocument = async (
    params: {
      agentId: string;
      documentId?: string;
      id: string;
      topicId?: string;
      /** Also delete documents nested under it; a parent with children is refused otherwise. */
      withChildren?: boolean;
    } & AgentDocumentToolTriggerInput,
  ) => {
    const { agentId, documentId, id, topicId, toolContext, trigger, withChildren } = params;
    const result = await lambdaClient.agentDocument.removeDocument.mutate({
      agentId,
      id,
      toolContext,
      trigger,
      withChildren,
    });
    await invalidateDocumentMutation({
      agentId,
      cause: 'agent-document',
      documentId,
      topicId,
    });

    return result;
  };

  copyDocument = async (
    params: { agentId: string; id: string; newTitle?: string } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.copyDocument.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  renameDocument = async (
    params: { agentId: string; id: string; newTitle: string } & AgentDocumentToolTriggerInput,
  ) => {
    const result = await lambdaClient.agentDocument.renameDocument.mutate(params);
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  convertDocumentToSkill = async (params: {
    agentId: string;
    description: string;
    name: string;
    sourceAgentDocumentId: string;
    title: string;
  }) => {
    const result = await lambdaClient.agentDocument.convertDocumentToSkill.mutate(params);
    // The conversion reparents the same row into a skill bundle, preserving its
    // documents.id / agent_documents.id. An editor that still has the document
    // open is cached as plain markdown, so invalidate its editor caches too —
    // otherwise the next autosave from that stale editor would overwrite the
    // generated SKILL.md frontmatter/body via the document save path.
    await invalidateDocumentMutation({
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: result.index.documentId,
    });

    return result;
  };

  /**
   * Runs on the `agentMeta` system agent model; a model only this device
   * reaches is relayed back to this tab (one-shot relay).
   */
  generateSkillMeta = async (params: { agentId: string; sourceAgentDocumentId: string }) => {
    const { provider } = systemAgentSelectors.agentMeta(useUserStore.getState());
    return oneShotRelay.run(provider, (relay) =>
      lambdaClient.agentDocument.generateSkillMeta.mutate(params, withLlmRelay(relay)),
    );
  };

  /**
   * Records implicit feedback on an auto-generated skill-meta generation: when
   * the user saves without editing the generated values it's a positive signal,
   * otherwise negative. Best-effort — never block the save on a feedback write.
   */
  recordSkillMetaFeedback = async (params: {
    data?: Record<string, unknown>;
    edited: boolean;
    tracingId: string;
  }) => {
    try {
      await lambdaClient.llmGenerationTracing.recordFeedback.mutate(
        {
          data: params.data,
          signal: params.edited ? 'negative' : 'positive',
          source: 'convert_to_skill',
          tracingId: params.tracingId,
        },
        { context: { showNotification: false } },
      );
    } catch (error) {
      console.warn('[agentDocument] Failed to record skill-meta feedback:', error);
    }
  };

  /** Tool-oriented: create a folder by name under the root or a parent folder id. */
  createFolderById = async (params: {
    agentId: string;
    parentId?: string | null;
    title: string;
  }) => {
    const result = await lambdaClient.agentDocument.createFolder.mutate(params);
    await revalidateAgentDocuments(params.agentId);

    return result;
  };

  /** Tool-oriented: move documents/folders by id into a folder, or to the root with null. */
  moveDocumentsById = async (params: {
    agentId: string;
    ids: string[];
    parentId: string | null;
  }) => {
    const result = await lambdaClient.agentDocument.moveDocuments.mutate(params);
    await revalidateAgentDocuments(params.agentId);

    return result;
  };

  updateLoadRule = async (params: {
    agentId: string;
    id: string;
    rule: {
      keywordMatchMode?: 'all' | 'any';
      keywords?: string[];
      maxTokens?: number;
      policyLoadFormat?: DocumentLoadFormat;
      priority?: number;
      regexp?: string;
      rule?: DocumentLoadRule;
      timeRange?: {
        from?: string;
        to?: string;
      };
    };
  }) => {
    const result = await lambdaClient.agentDocument.updateLoadRule.mutate(params);
    await revalidateAgentDocuments(params.agentId);

    return result;
  };
}

export const resolveAgentDocumentsContext = async (params: {
  agentId?: string;
  cachedDocuments?: AgentContextDocument[];
}) => {
  const { agentId, cachedDocuments } = params;

  if (cachedDocuments !== undefined) return cachedDocuments;
  if (!agentId) return undefined;

  const documents = await agentDocumentService.getContextDocuments({ agentId });

  return toAgentContextDocuments(documents);
};

export const agentDocumentService = new AgentDocumentService();

export type AgentDocumentListItem = Awaited<
  ReturnType<typeof agentDocumentService.listDocuments>
>[number];
