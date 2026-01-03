import { type DocumentItem } from '@lobechat/database/schemas';

import { lambdaClient } from '@/libs/trpc/client';

export interface CreateDocumentParams {
  content?: string;
  editorData: string;
  fileType?: string;
  knowledgeBaseId?: string;
  metadata?: Record<string, any>;
  parentId?: string;
  slug?: string;
  title: string;
}

export interface UpdateDocumentParams {
  content?: string;
  editorData?: string;
  fileType?: string;
  id: string;
  metadata?: Record<string, any>;
  parentId?: string | null;
  title?: string;
}

export class DocumentService {
  async createDocument(params: CreateDocumentParams): Promise<DocumentItem> {
    return lambdaClient.document.createDocument.mutate(params);
  }

  async queryDocuments(params?: {
    current?: number;
    fileTypes?: string[];
    pageSize?: number;
    sourceTypes?: string[];
  }): Promise<{ items: DocumentItem[]; total: number }> {
    return lambdaClient.document.queryDocuments.query(params);
  }

  async getDocumentById(id: string): Promise<DocumentItem | undefined> {
    return lambdaClient.document.getDocumentById.query({ id });
  }

  async deleteDocument(id: string): Promise<void> {
    await lambdaClient.document.deleteDocument.mutate({ id });
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    await lambdaClient.document.deleteDocuments.mutate({ ids });
  }

  async updateDocument(params: UpdateDocumentParams): Promise<void> {
    await lambdaClient.document.updateDocument.mutate(params);
  }
}

export const documentService = new DocumentService();
