import type { LobeChatDatabase } from '@lobechat/database';
import type { DocumentItem } from '@lobechat/database/schemas';

import { DocumentModel } from '@/database/models/document';

import { DocumentService } from '../document';
import {
  type AgentDocumentLiteXMLOperation,
  applyLiteXMLOperations,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
} from '../document/headlessEditor';

const PERSONAL_PAGE_FILE_TYPES = ['custom/document'];

export interface PersonalPageSnapshot {
  content: string;
  id: string;
  litexml?: string;
  title: string | null;
}

export class PersonalPagesService {
  private documentModel: DocumentModel;
  private documentService: DocumentService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.documentModel = new DocumentModel(db, userId);
    this.documentService = new DocumentService(db, userId);
  }

  async createPage(title: string, content: string): Promise<DocumentItem> {
    return this.documentService.createDocument({
      content,
      editorData: {},
      fileType: 'custom/document',
      metadata: {
        createdAt: Date.now(),
      },
      title,
    });
  }

  async readPage(
    documentId: string,
    options: { format?: 'both' | 'markdown' | 'xml' } = {},
  ): Promise<PersonalPageSnapshot | undefined> {
    const doc = await this.documentModel.findById(documentId);
    if (!doc) return undefined;

    const litexml = options.format === 'xml' || options.format === 'both';

    const snapshot = await exportEditorDataSnapshot({
      editorData: doc.editorData as Record<string, any> | null | undefined,
      fallbackContent: doc.content ?? '',
      litexml,
    });

    const content =
      snapshot.content.trim().length === 0 && (doc.content ?? '').trim().length > 0
        ? (doc.content ?? '')
        : snapshot.content;

    return {
      content,
      id: doc.id,
      litexml: snapshot.litexml,
      title: doc.title,
    };
  }

  async replaceContent(
    documentId: string,
    content: string,
  ): Promise<PersonalPageSnapshot | undefined> {
    const doc = await this.documentModel.findById(documentId);
    if (!doc) return undefined;

    const snapshot = await createMarkdownEditorSnapshot(content);

    if (doc.content !== snapshot.content) {
      await this.documentService.trySaveCurrentDocumentHistory(documentId, 'llm_call');
    }

    await this.documentModel.update(documentId, {
      content: snapshot.content,
      editorData: snapshot.editorData,
    });

    return this.readPage(documentId);
  }

  async modifyNodes(
    documentId: string,
    operations: AgentDocumentLiteXMLOperation[],
  ): Promise<PersonalPageSnapshot | undefined> {
    const doc = await this.documentModel.findById(documentId);
    if (!doc) return undefined;

    await this.documentService.trySaveCurrentDocumentHistory(documentId, 'llm_call');

    const snapshot = await applyLiteXMLOperations({
      editorData: doc.editorData as Record<string, any> | null | undefined,
      fallbackContent: doc.content ?? '',
      operations,
    });

    await this.documentModel.update(documentId, {
      content: snapshot.content,
      editorData: snapshot.editorData,
    });

    return this.readPage(documentId);
  }

  async listPages(): Promise<DocumentItem[]> {
    const { items } = await this.documentModel.query({
      fileTypes: PERSONAL_PAGE_FILE_TYPES,
    });

    return items.filter((doc) => !doc.metadata?.knowledgeBaseId);
  }
}
