import type { DocumentLoadFormat, DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';
import { AgentDocumentsExecutor } from '@lobechat/builtin-tool-agent-documents/executor';

import { agentDocumentService } from '@/services/agentDocument';

const runtime = new AgentDocumentsExecutionRuntime({
  copyDocument: ({ agentId, id, newTitle }) =>
    agentDocumentService.copyDocument({ agentId, id, newTitle }),
  createDocument: ({ agentId, content, title }) =>
    agentDocumentService.createDocument({ agentId, content, title }),
  createTopicDocument: ({ agentId, content, title, topicId }) =>
    agentDocumentService.createForTopic({ agentId, content, title, topicId }),
  editDocument: ({ agentId, content, id }) =>
    agentDocumentService.editDocument({ agentId, content, id }),
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
  readDocumentByFilename: ({ agentId, filename, format }) =>
    agentDocumentService.readDocumentByFilename({ agentId, filename, format: format ?? 'xml' }),
  removeDocument: async ({ agentId, id }) =>
    (await agentDocumentService.removeDocument({ agentId, id })).deleted,
  renameDocument: ({ agentId, id, newTitle }) =>
    agentDocumentService.renameDocument({ agentId, id, newTitle }),
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
  upsertDocumentByFilename: ({ agentId, content, filename }) =>
    agentDocumentService.upsertDocumentByFilename({ agentId, content, filename }),
});

export const agentDocumentsExecutor = new AgentDocumentsExecutor(runtime);
