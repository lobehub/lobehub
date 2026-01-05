import { type DocumentType } from '@lobechat/builtin-tool-notebook';

import { lambdaClient } from '@/libs/trpc/client';

type ExtendedDocumentType = DocumentType | 'agent/plan';

interface CreateDocumentParams {
  content: string;
  description: string;
  metadata?: Record<string, any>;
  source?: string;
  sourceType?: 'file' | 'web' | 'api' | 'topic';
  title: string;
  topicId: string;
  type?: ExtendedDocumentType;
}

interface UpdateDocumentParams {
  append?: boolean;
  content?: string;
  description?: string;
  id: string;
  metadata?: Record<string, any>;
  title?: string;
}

interface ListDocumentsParams {
  topicId: string;
  type?: ExtendedDocumentType;
}

class NotebookService {
  createDocument = async (params: CreateDocumentParams) => {
    return lambdaClient.notebook.createDocument.mutate(params);
  };

  updateDocument = async (params: UpdateDocumentParams) => {
    return lambdaClient.notebook.updateDocument.mutate(params);
  };

  getDocument = async (id: string) => {
    return lambdaClient.notebook.getDocument.query({ id });
  };

  listDocuments = async (params: ListDocumentsParams) => {
    return lambdaClient.notebook.listDocuments.query(params);
  };

  deleteDocument = async (id: string) => {
    return lambdaClient.notebook.deleteDocument.mutate({ id });
  };
}

export const notebookService = new NotebookService();
