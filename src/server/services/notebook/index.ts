import { type LobeChatDatabase } from '@lobechat/database';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

interface DocumentServiceResult {
  content: string | null;
  createdAt: Date;
  description: string | null;
  fileType: string;
  id: string;
  source: string;
  sourceType: 'api' | 'file' | 'web';
  title: string | null;
  totalCharCount: number;
  updatedAt: Date;
}

export interface NotebookRuntimeServiceOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

const toServiceResult = (doc: {
  content: string | null;
  createdAt: Date;
  description: string | null;
  fileType: string;
  id: string;
  source: string;
  sourceType: 'api' | 'file' | 'web' | 'topic';
  title: string | null;
  totalCharCount: number;
  updatedAt: Date;
}): DocumentServiceResult => ({
  content: doc.content,
  createdAt: doc.createdAt,
  description: doc.description,
  fileType: doc.fileType,
  id: doc.id,
  source: doc.source,
  sourceType: doc.sourceType === 'topic' ? 'api' : doc.sourceType,
  title: doc.title,
  totalCharCount: doc.totalCharCount,
  updatedAt: doc.updatedAt,
});

export class NotebookRuntimeService {
  private documentModel: DocumentModel;
  private topicDocumentModel: TopicDocumentModel;

  constructor(options: NotebookRuntimeServiceOptions) {
    this.documentModel = new DocumentModel(options.serverDB, options.userId);
    this.topicDocumentModel = new TopicDocumentModel(options.serverDB, options.userId);
  }

  associateDocumentWithTopic = async (documentId: string, topicId: string): Promise<void> => {
    await this.topicDocumentModel.associate({ documentId, topicId });
  };

  createDocument = async (params: {
    content: string;
    fileType: string;
    source: string;
    sourceType: 'api' | 'file' | 'web';
    title: string;
    totalCharCount: number;
    totalLineCount: number;
  }): Promise<DocumentServiceResult> => {
    const doc = await this.documentModel.create(params);
    return toServiceResult(doc);
  };

  deleteDocument = async (id: string): Promise<void> => {
    await this.topicDocumentModel.deleteByDocumentId(id);
    await this.documentModel.delete(id);
  };

  getDocument = async (id: string): Promise<DocumentServiceResult | undefined> => {
    const doc = await this.documentModel.findById(id);
    if (!doc) return undefined;
    return toServiceResult(doc);
  };

  getDocumentsByTopicId = async (
    topicId: string,
    filter?: { type?: string },
  ): Promise<DocumentServiceResult[]> => {
    const docs = await this.topicDocumentModel.findByTopicId(topicId, filter);
    return docs.map(toServiceResult);
  };

  updateDocument = async (
    id: string,
    params: { content?: string; title?: string },
  ): Promise<DocumentServiceResult> => {
    await this.documentModel.update(id, {
      ...(params.content !== undefined && {
        content: params.content,
        totalCharCount: params.content.length,
        totalLineCount: params.content.split('\n').length,
      }),
      ...(params.title !== undefined && { title: params.title }),
    });

    const doc = await this.documentModel.findById(id);
    if (!doc) throw new Error(`Document not found after update: ${id}`);
    return toServiceResult(doc);
  };
}
