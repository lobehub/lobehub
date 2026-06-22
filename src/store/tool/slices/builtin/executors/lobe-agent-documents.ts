import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { AgentDocumentsExecutor } from '@lobechat/builtin-tool-agent-documents/executor';
import { isDesktop } from '@lobechat/const';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { agentDocumentService } from '@/services/agentDocument';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

/**
 * App origin for share links. Desktop points at the connected remote server so
 * the link opens the cloud app; web uses the current origin.
 */
const getAppOrigin = (): string | undefined => {
  if (isDesktop) return electronSyncSelectors.remoteServerUrl(useElectronStore.getState());
  return typeof window === 'undefined' ? undefined : window.location.origin;
};

const runtime = new AgentDocumentsExecutionRuntime(
  {
    copyDocument: ({ agentId, id, newTitle }) =>
      agentDocumentService.copyDocument({ agentId, id, newTitle }),
    createDocument: ({ agentId, content, hintIsSkill, title, toolContext, trigger }) =>
      agentDocumentService.createDocument({
        agentId,
        content,
        hintIsSkill,
        title,
        toolContext,
        trigger,
      }),
    createTopicDocument: ({
      agentId,
      content,
      hintIsSkill,
      title,
      toolContext,
      topicId,
      trigger,
    }) =>
      agentDocumentService.createForTopic({
        agentId,
        content,
        hintIsSkill,
        title,
        toolContext,
        topicId,
        trigger,
      }),
    listDocuments: async ({ agentId, sourceType }) => {
      // The agent listing tool surfaces archived `.tool-results` so the model can
      // discover them; user-facing lists keep the default (filtered) behavior.
      const docs = await agentDocumentService.listDocuments({
        agentId,
        includeArchivedToolResults: true,
        sourceType,
      });
      return docs.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        id: d.id,
        title: d.title,
      }));
    },
    listTopicDocuments: async ({ agentId, sourceType, topicId }) => {
      const docs = await agentDocumentService.listDocuments({
        agentId,
        includeArchivedToolResults: true,
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
    modifyNodes: ({ agentId, id, operations }) =>
      agentDocumentService.modifyNodes({ agentId, id, operations }),
    readDocument: ({ agentId, format, id }) =>
      agentDocumentService.readDocument({ agentId, format: format ?? 'xml', id }),
    removeDocument: async ({ agentId, id }) =>
      (await agentDocumentService.removeDocument({ agentId, id })).deleted,
    renameDocument: ({ agentId, id, newTitle }) =>
      agentDocumentService.renameDocument({ agentId, id, newTitle }),
    replaceDocumentContent: ({ agentId, content, id }) =>
      agentDocumentService.replaceDocumentContent({ agentId, content, id }),
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
    getDocumentUrl: ({ agentId, documentId }) =>
      buildAgentDocumentUrl(getAppOrigin(), agentId, documentId, {
        workspaceSlug: getActiveWorkspaceSlug(),
      }),
  },
);

export const agentDocumentsExecutor = new AgentDocumentsExecutor(runtime);
