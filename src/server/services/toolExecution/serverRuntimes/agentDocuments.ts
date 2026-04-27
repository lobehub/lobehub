import type { DocumentLoadRule } from '@lobechat/agent-templates';
import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsExecutionRuntime } from '@lobechat/builtin-tool-agent-documents/executionRuntime';

import { TaskModel } from '@/database/models/task';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

import { type ServerRuntimeRegistration } from './types';

export const agentDocumentsRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Agent Documents execution');
    }

    const service = new AgentDocumentsService(context.serverDB, context.userId);
    const taskModel = new TaskModel(context.serverDB, context.userId);
    const { taskId } = context;

    const pinToTask = async <T extends { documentId?: string } | undefined>(doc: T): Promise<T> => {
      if (taskId && doc?.documentId) {
        await taskModel.pinDocument(taskId, doc.documentId, 'agent');
      }
      return doc;
    };

    return new AgentDocumentsExecutionRuntime({
      copyDocument: async ({ agentId, id, newTitle }) =>
        pinToTask(await service.copyDocumentById(id, newTitle, agentId)),
      createDocument: async ({ agentId, content, title }) =>
        pinToTask(await service.createDocument(agentId, title, content)),
      createTopicDocument: async ({ agentId, content, title, topicId }) =>
        pinToTask(await service.createForTopic(agentId, title, content, topicId)),
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
      upsertDocumentByFilename: async ({ agentId, content, filename }) =>
        pinToTask(await service.upsertDocumentByFilename({ agentId, content, filename })),
    });
  },
  identifier: AgentDocumentsIdentifier,
};
