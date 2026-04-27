import type { DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';

import { AgentDocumentsService } from '@/server/services/agentDocuments';

import { type ServerRuntimeRegistration } from './types';

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const service = new AgentDocumentsService(context.serverDB, context.userId);

    return new AgentDocumentsExecutionRuntime({
      copyDocument: ({ agentId, id, newTitle }) => service.copyDocumentById(id, newTitle, agentId),
      createDocument: ({ agentId, content, title }) =>
        service.createDocument(agentId, title, content),
      createTopicDocument: ({ agentId, content, title, topicId }) =>
        service.createForTopic(agentId, title, content, topicId),
      editDocument: ({ agentId, content, id }) => service.editDocumentById(id, content, agentId),
      listDocuments: async ({ agentId }) => {
        const docs = await service.listDocuments(agentId);
        return docs.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          id: d.id,
          title: d.title,
        }));
      },
      listTopicDocuments: async ({ agentId, topicId }) => {
        const docs = await service.listDocumentsForTopic(agentId, topicId);
        return docs.map((d) => ({
          documentId: d.documentId,
          filename: d.filename,
          id: d.id,
          title: d.title,
        }));
      },
      modifyNodes: ({ agentId, id, operations }) =>
        service.modifyDocumentNodesById(id, operations, agentId),
      readDocument: ({ agentId, id }) => service.getDocumentSnapshotById(id, agentId),
      readDocumentByFilename: ({ agentId, filename }) =>
        service.getDocumentSnapshotByFilename(agentId, filename),
      removeDocument: ({ agentId, id }) => service.removeDocumentById(id, agentId),
      renameDocument: ({ agentId, id, newTitle }) =>
        service.renameDocumentById(id, newTitle, agentId),
      updateLoadRule: ({ agentId, id, rule }) =>
        service.updateLoadRuleById(
          id,
          { ...rule, rule: rule.rule as DocumentLoadRule | undefined },
          agentId,
        ),
      upsertDocumentByFilename: ({ agentId, content, filename }) =>
        service.upsertDocumentByFilename({ agentId, content, filename }),
    });
  },
  identifier: AgentDocumentsIdentifier,
};
