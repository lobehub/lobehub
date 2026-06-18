import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import type { ConversationContext, RuntimeActiveTopicDocumentContext } from '@lobechat/types';

import { agentDocumentService } from '@/services/agentDocument';

export const mergeAgentRuntimeInitialContexts = (
  ...contexts: Array<AgentRuntimeContext | undefined>
): AgentRuntimeContext | undefined => {
  const validContexts = contexts.filter(Boolean) as AgentRuntimeContext[];
  if (validContexts.length === 0) return undefined;

  const firstContext = validContexts[0]!;

  return validContexts.reduce<AgentRuntimeContext>(
    (acc, context) => ({
      ...acc,
      ...context,
      initialContext: {
        ...acc.initialContext,
        ...context.initialContext,
      },
      payload:
        acc.payload &&
        context.payload &&
        typeof acc.payload === 'object' &&
        typeof context.payload === 'object'
          ? {
              ...(acc.payload as Record<string, unknown>),
              ...(context.payload as Record<string, unknown>),
            }
          : (context.payload ?? acc.payload),
    }),
    { phase: firstContext.phase },
  );
};

const resolveActiveTopicDocument = async (
  context: ConversationContext,
): Promise<RuntimeActiveTopicDocumentContext | undefined> => {
  if (context.scope === 'page') return;
  if (!context.agentId || !context.documentId) return;

  // When the caller already knows the agent_documents row id (e.g. portal
  // openers pass it through), skip the listDocuments reverse lookup entirely —
  // the lookup is scoped to currentTopic and would miss docs opened outside
  // the active topic (skills, web docs).
  if (context.agentDocumentId) {
    return {
      agentDocumentId: context.agentDocumentId,
      documentId: context.documentId,
    };
  }

  if (!context.topicId) return;

  try {
    const documents = await agentDocumentService.listDocuments({
      agentId: context.agentId,
      scope: 'currentTopic',
      topicId: context.topicId,
    });
    const matchedDocument = documents.find(
      (document) => document.documentId === context.documentId,
    );

    return {
      agentDocumentId: matchedDocument?.id,
      documentId: context.documentId,
      title: matchedDocument?.title,
    };
  } catch (error) {
    console.error('[activeTopicDocumentContext] Failed to resolve topic document context:', error);

    return {
      documentId: context.documentId,
    };
  }
};

export const resolveActiveTopicDocumentInitialContext = async (
  context: ConversationContext,
): Promise<AgentRuntimeContext | undefined> => {
  const activeTopicDocument = await resolveActiveTopicDocument(context);
  if (!activeTopicDocument) return;

  return {
    initialContext: {
      activeTopicDocument,
    },
    phase: 'init',
  };
};
