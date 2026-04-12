import { type DocumentItem } from '@lobechat/database/schemas';

import { lambdaClient } from '@/libs/trpc/client';

import { abortableRequest } from '../utils/abortableRequest';

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

  async createDocuments(documents: CreateDocumentParams[]): Promise<DocumentItem[]> {
    return lambdaClient.document.createDocuments.mutate({ documents });
  }

  async queryDocuments(params?: {
    current?: number;
    fileTypes?: string[];
    pageSize?: number;
    sourceTypes?: string[];
  }): Promise<{ items: DocumentItem[]; total: number }> {
    return lambdaClient.document.queryDocuments.query(params);
  }

  /**
   * Query page documents with standard filters for the page sidebar.
   */
  async getPageDocuments(pageSize: number = 20): Promise<DocumentItem[]> {
    const result = await this.queryDocuments({
      current: 0,
      fileTypes: ['custom/document', 'application/pdf'],
      pageSize,
      sourceTypes: ['editor', 'file', 'api'],
    });

    return result.items
      .filter(
        (doc) =>
          ['editor', 'file', 'api'].includes(doc.sourceType) &&
          ['custom/document', 'application/pdf'].includes(doc.fileType),
      )
      .map((doc) => ({ ...doc, filename: doc.filename ?? doc.title ?? 'Untitled' }));
  }

  async getDocumentById(id: string, uniqueKey?: string): Promise<DocumentItem | undefined> {
    if (uniqueKey) {
      // Use fixed key so switching documents cancels the previous request
      // This prevents race conditions where old document's data overwrites new document's editor
      return abortableRequest.execute(uniqueKey, async (signal) =>
        lambdaClient.document.getDocumentById.query({ id }, { signal }),
      );
    }

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
