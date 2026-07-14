import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { AgentDocumentsExecutor } from '@lobechat/builtin-tool-agent-documents/executor';
import { isDesktop } from '@lobechat/const';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { agentDocumentService } from '@/services/agentDocument';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { workService } from '@/services/work';
import { useAgentStore } from '@/store/agent';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { stashWorkIntent } from '@/utils/clientWorkIntentStash';

interface DocumentWorkRefreshContext {
  threadId?: string | null;
  topicId?: string;
}

/**
 * App origin for share links. Desktop points at the connected remote server so
 * the link opens the cloud app; web uses the current origin.
 */
const getAppOrigin = (): string | undefined => {
  if (isDesktop) return electronSyncSelectors.remoteServerUrl(useElectronStore.getState());
  return typeof window === 'undefined' ? undefined : window.location.origin;
};

/** Build the sharable document URL for the active workspace (stash intent + tool result share both use it). */
const buildDocumentShareUrl = (agentId: string, documentId: string): string | undefined =>
  buildAgentDocumentUrl(getAppOrigin(), agentId, documentId, {
    workspaceSlug: getActiveWorkspaceSlug(),
  });

const refreshDocumentWorks = async (context?: DocumentWorkRefreshContext) => {
  if (!context) return;

  // Summary chips + sidebar summary ride the message payload, so refreshing the
  // conversation (message list + sidebar history) covers them.
  await workService.refreshConversation(context.topicId, context.threadId).catch((error) => {
    console.error('[AgentDocumentsExecutor] refresh document works failed:', error);
  });
};

const withWorkRefresh = async <T>(operation: Promise<T>, context?: DocumentWorkRefreshContext) => {
  const result = await operation;
  await refreshDocumentWorks(context);
  return result;
};

/**
 * Stash a document Work-registration intent for a create/update tool mutation,
 * keyed by `toolCallId`. `call_tool` drains it and registers the Work ONCE the
 * tool call's cumulative cost is known — replacing the old lambda-side inline
 * (cost-less) registration + client cost back-fill. Deletes are NOT stashed:
 * they remain a lambda side-effect of removeDocument (a delete carries no cost).
 */
const stashDocumentRegisterIntent = (input: {
  agentDocumentId?: string;
  agentId: string;
  description?: string | null;
  documentId?: string;
  changeType: 'created' | 'updated';
  toolName: string;
  toolCallId?: string;
}) => {
  if (!input.toolCallId || !input.documentId) return;

  stashWorkIntent(input.toolCallId, {
    action: 'register',
    document: {
      agentDocumentId: input.agentDocumentId,
      agentId: input.agentId,
      description: input.description,
      documentId: input.documentId,
      changeType: input.changeType,
      toolName: input.toolName,
    },
    type: 'document',
  });
};

const runtime = new AgentDocumentsExecutionRuntime(
  {
    copyDocument: async ({ agentId, id, newTitle, toolContext, trigger }) => {
      const doc = await agentDocumentService.copyDocument({
        agentId,
        id,
        newTitle,
        toolContext,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: doc?.id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'created',
        toolName: 'copyDocument',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    createDocument: async ({ agentId, content, hintIsSkill, title, toolContext, trigger }) => {
      const doc = await agentDocumentService.createDocument({
        agentId,
        content,
        hintIsSkill,
        title,
        toolContext,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: doc?.id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'created',
        toolName: 'createDocument',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    createTopicDocument: async ({
      agentId,
      content,
      hintIsSkill,
      title,
      toolContext,
      topicId,
      trigger,
    }) => {
      const doc = await agentDocumentService.createForTopic({
        agentId,
        content,
        hintIsSkill,
        title,
        toolContext,
        topicId,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: doc?.id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'created',
        toolName: 'createForTopic',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    listDocuments: async ({ agentId, parentId, sourceType }) => {
      // The agent listing tool surfaces archived `.tool-results` so the model can
      // discover them; user-facing lists keep the default (filtered) behavior.
      const docs = await agentDocumentService.listDocuments({
        agentId,
        includeArchivedToolResults: true,
        parentId,
        sourceType,
      });
      return docs.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        id: d.id,
        title: d.title,
      }));
    },
    listTopicDocuments: async ({ agentId, parentId, sourceType, topicId }) => {
      const docs = await agentDocumentService.listDocuments({
        agentId,
        includeArchivedToolResults: true,
        parentId,
        scope: 'currentTopic',
        sourceType,
        topicId,
      });
      return docs.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        id: d.id,
        title: d.title,
      }));
    },
    modifyNodes: async ({ agentId, id, operations, toolContext, trigger }) => {
      const doc = await agentDocumentService.modifyNodes({
        agentId,
        id,
        operations,
        toolContext,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'updated',
        toolName: 'modifyNodes',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    readDocument: ({ agentId, format, id }) =>
      agentDocumentService.readDocument({ agentId, format: format ?? 'xml', id }),
    // Delete stays a lambda side-effect (removeDocument drops the Work server-side);
    // it carries no cost, so it needs no cost-stamping defer. Keep the immediate
    // work-cache refresh so the sidebar drops the removed doc.
    removeDocument: async ({ agentId, id, toolContext, trigger }) =>
      (
        await withWorkRefresh(
          agentDocumentService.removeDocument({ agentId, id, toolContext, trigger }),
          toolContext,
        )
      ).deleted,
    renameDocument: async ({ agentId, id, newTitle, toolContext, trigger }) => {
      const doc = await agentDocumentService.renameDocument({
        agentId,
        id,
        newTitle,
        toolContext,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'updated',
        toolName: 'renameDocument',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    replaceDocumentContent: async ({ agentId, content, id, toolContext, trigger }) => {
      const doc = await agentDocumentService.replaceDocumentContent({
        agentId,
        content,
        id,
        toolContext,
        trigger,
      });
      stashDocumentRegisterIntent({
        agentDocumentId: id,
        agentId,
        description: doc?.description,
        documentId: doc?.documentId,
        changeType: 'updated',
        toolName: 'replaceDocumentContent',
        toolCallId: toolContext?.toolCallId,
      });
      return doc;
    },
    updateLoadRule: ({ agentId, id, rule }) =>
      agentDocumentService.updateLoadRule({
        agentId,
        id,
        rule: {
          ...rule,
          policyLoadFormat: rule.policyLoadFormat as DocumentLoadFormat | undefined,
          rule: rule.rule as DocumentLoadRule | undefined,
        },
      }),
  },
  {
    getDocumentUrl: ({ agentId, documentId }) => buildDocumentShareUrl(agentId, documentId),
    // Revalidate the documents list after the agent mutates it. `onAfterCall`
    // carries no agentId, so resolve the active chat agent — the one whose run
    // just produced the tool call. Covers the server-runtime path where the
    // client service layer never invalidates.
    onDocumentsMutated: async () => {
      const agentId = useAgentStore.getState().activeAgentId;
      if (!agentId) return;
      await invalidateDocumentMutation({ agentId, cause: 'agent-document' });
    },
  },
);

export const agentDocumentsExecutor = new AgentDocumentsExecutor(runtime);
