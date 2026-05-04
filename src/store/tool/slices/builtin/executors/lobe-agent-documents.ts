import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { AgentDocumentsExecutor } from '@lobechat/builtin-tool-agent-documents/executor';

import { agentDocumentService } from '@/services/agentDocument';

const runtime = new AgentDocumentsExecutionRuntime({
  copyDocument: ({ agentId, id, newTitle }) =>
    agentDocumentService.copyDocument({ agentId, id, newTitle }),
  createDocument: ({ agentId, content, hintIsSkill, title }) =>
    agentDocumentService.createDocument({ agentId, content, hintIsSkill, title }),
  createTopicDocument: ({ agentId, content, hintIsSkill, title, topicId }) =>
    agentDocumentService.createForTopic({ agentId, content, hintIsSkill, title, topicId }),
  listDocuments: async ({ agentId }) => {
    const docs = await agentDocumentService.listDocuments({ agentId });
    return docs.map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      id: d.id,
      title: d.title,
    }));
  },
  listTopicDocuments: async ({ agentId, topicId }) => {
    const docs = await agentDocumentService.listDocuments({
      agentId,
      target: 'currentTopic',
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
});

export const agentDocumentsExecutor = new AgentDocumentsExecutor(runtime);
