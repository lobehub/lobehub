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
      editDocument: ({ agentId, content, id }) => service.editDocumentById(id, content, agentId),
      listDocuments: async ({ agentId }) => {
        const docs = await service.listDocuments(agentId);
        return docs.map((d) => ({ filename: d.filename, id: d.id, title: d.title }));
      },
      readDocument: ({ agentId, id }) => service.getDocumentById(id, agentId),
      readDocumentByFilename: ({ agentId, filename }) =>
        service.getDocumentByFilename(agentId, filename),
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
