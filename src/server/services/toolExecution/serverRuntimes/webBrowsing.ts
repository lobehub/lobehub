import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

import { DocumentModel } from '@/database/models/document';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { SearchService } from '@/server/services/search';

import { type ServerRuntimeRegistration } from './types';

export const webBrowsingRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    const { userId, serverDB, agentId } = context;
    const canSaveDocuments = userId && serverDB && agentId;

    return new WebBrowsingExecutionRuntime({
      documentService: canSaveDocuments
        ? {
            associateDocument: async (documentId) => {
              const service = new AgentDocumentsService(serverDB, userId);
              await service.associateDocument(agentId, documentId);
            },
            createDocument: async ({ content, description, title, url }) => {
              const model = new DocumentModel(serverDB, userId);
              return model.create({
                content,
                description,
                fileType: 'article',
                filename: title,
                source: url,
                sourceType: 'web',
                title,
                totalCharCount: content.length,
                totalLineCount: content.split('\n').length,
              });
            },
          }
        : undefined,
      searchService: new SearchService(),
    });
  },
  identifier: WebBrowsingManifest.identifier,
};
