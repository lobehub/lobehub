import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import {
  AGENT_DOCUMENT_INJECTION_POSITIONS,
  type AgentContextDocument,
} from '@lobechat/context-engine';

import { lambdaClient } from '@/libs/trpc/client';
import { invalidateDocumentMutation } from '@/services/document/invalidation';

export { agentDocumentSWRKeys } from '@/services/document/swrKeys';

const VALID_DOCUMENT_POSITIONS = new Set<AgentContextDocument['loadPosition']>(
  AGENT_DOCUMENT_INJECTION_POSITIONS,
);

export const normalizeAgentDocumentPosition = (
  position: string | null | undefined,
): AgentContextDocument['loadPosition'] | undefined => {
  if (!position) return undefined;

  return VALID_DOCUMENT_POSITIONS.has(position as AgentContextDocument['loadPosition'])
    ? (position as AgentContextDocument['loadPosition'])
    : undefined;
};

const revalidateAgentDocuments = async (agentId: string) => {
  await invalidateDocumentMutation({ agentId, cause: 'agent-document' });
};

const getStringField = (value: unknown, field: 'documentId' | 'id') => {
  if (!value || typeof value !== 'object' || !(field in value)) return undefined;

  const fieldValue = (value as Record<string, unknown>)[field];

  return typeof fieldValue === 'string' ? fieldValue : undefined;
};

const getAgentDocumentId = (value: unknown) => getStringField(value, 'id');

const getDocumentId = (value: unknown) => getStringField(value, 'documentId');

class AgentDocumentService {
  getTemplates = async () => {
    return lambdaClient.agentDocument.getTemplates.query();
  };

  getDocuments = async (params: { agentId: string }) => {
    return lambdaClient.agentDocument.getDocuments.query(params);
  };

  initializeFromTemplate = async (params: { agentId: string; templateSet: string }) => {
    const result = await lambdaClient.agentDocument.initializeFromTemplate.mutate(params);
    await revalidateAgentDocuments(params.agentId);

    return result;
  };

  listDocuments = async (params: {
    agentId: string;
    target?: 'agent' | 'currentTopic';
    topicId?: string;
  }) => {
    return lambdaClient.agentDocument.listDocuments.query(params);
  };

  readDocumentByFilename = async (params: {
    agentId: string;
    filename: string;
    format?: 'xml' | 'markdown' | 'both';
  }) => {
    return lambdaClient.agentDocument.readDocumentByFilename.query(params);
  };

  upsertDocumentByFilename = async (params: {
    agentId: string;
    content: string;
    filename: string;
  }) => {
    const result = await lambdaClient.agentDocument.upsertDocumentByFilename.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: getAgentDocumentId(result),
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  associateDocument = async (params: { agentId: string; documentId: string }) => {
    const result = await lambdaClient.agentDocument.associateDocument.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: getAgentDocumentId(result),
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: params.documentId,
    });

    return result;
  };

  createDocument = async (params: { agentId: string; content: string; title: string }) => {
    const result = await lambdaClient.agentDocument.createDocument.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: getAgentDocumentId(result),
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  createForTopic = async (params: {
    agentId: string;
    content: string;
    title: string;
    topicId: string;
  }) => {
    const result = await lambdaClient.agentDocument.createForTopic.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: getAgentDocumentId(result),
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

  editDocument = async (params: { agentId: string; content: string; id: string }) => {
    const result = await lambdaClient.agentDocument.editDocument.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: params.id,
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  modifyNodes = async (params: {
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
  }) => {
    const result = await lambdaClient.agentDocument.modifyNodes.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: params.id,
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  removeDocument = async (params: {
    agentId: string;
    documentId?: string;
    id: string;
    topicId?: string;
  }) => {
    const { agentId, documentId, id, topicId } = params;
    const result = await lambdaClient.agentDocument.removeDocument.mutate({ agentId, id });
    await invalidateDocumentMutation({
      agentDocumentId: id,
      agentId,
      cause: 'agent-document',
      documentId,
      topicId,
    });

    return result;
  };

  copyDocument = async (params: { agentId: string; id: string; newTitle?: string }) => {
    const result = await lambdaClient.agentDocument.copyDocument.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: getAgentDocumentId(result),
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

    return result;
  };

  renameDocument = async (params: { agentId: string; id: string; newTitle: string }) => {
    const result = await lambdaClient.agentDocument.renameDocument.mutate(params);
    await invalidateDocumentMutation({
      agentDocumentId: params.id,
      agentId: params.agentId,
      cause: 'agent-document',
      documentId: getDocumentId(result),
    });

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

export const mapAgentDocumentsToContext = (
  documents: Awaited<ReturnType<AgentDocumentService['getDocuments']>>,
): AgentContextDocument[] =>
  documents.map((doc) => ({
    content: doc.content,
    description: doc.description ?? undefined,
    filename: doc.filename,
    id: doc.id,
    loadPosition: normalizeAgentDocumentPosition(
      doc.policy?.context?.position || doc.policyLoadPosition,
    ),
    loadRules: doc.loadRules,
    policyId: doc.templateId,
    policyLoad: doc.policyLoad as 'always' | 'progressive',
    policyLoadFormat: doc.policy?.context?.policyLoadFormat || doc.policyLoadFormat || undefined,
    title: doc.title,
  }));

export const resolveAgentDocumentsContext = async (params: {
  agentId?: string;
  cachedDocuments?: AgentContextDocument[];
}) => {
  const { agentId, cachedDocuments } = params;

  if (cachedDocuments !== undefined) return cachedDocuments;
  if (!agentId) return undefined;

  const documents = await agentDocumentService.getDocuments({ agentId });

  return mapAgentDocumentsToContext(documents);
};

export const agentDocumentService = new AgentDocumentService();
