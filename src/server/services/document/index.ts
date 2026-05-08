import { type LobeChatDatabase } from '@lobechat/database';
import { type DocumentItem } from '@lobechat/database/schemas';
import { documents, files } from '@lobechat/database/schemas';
import { loadFile } from '@lobechat/file-loaders';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { normalizeEditorDataDiffNodes } from '@/libs/editor/normalizeDiffNodes';
import { type LobeDocument } from '@/types/document';

import { FileService } from '../file';
import { DocumentHistoryService } from './history';
import type {
  CompareDocumentHistoryItemsParams,
  CompareDocumentHistoryItemsResult,
  DocumentHistoryAccessOptions,
  DocumentHistorySaveSource,
  GetDocumentHistoryItemParams,
  ListDocumentHistoryParams,
  ListDocumentHistoryResult,
  SaveDocumentHistoryResult,
  UpdateDocumentParams,
  UpdateDocumentResult,
} from './types';

const log = debug('lobe-chat:service:document');

export class DocumentService {
  userId: string;
  private fileModel: FileModel;
  private documentModel: DocumentModel;
  private documentHistoryServiceInstance?: DocumentHistoryService;
  private fileServiceInstance?: FileService;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.fileModel = new FileModel(db, userId);
    this.documentModel = new DocumentModel(db, userId);
  }

  private get fileService() {
    this.fileServiceInstance ??= new FileService(this.db, this.userId);

    return this.fileServiceInstance;
  }

  private get documentHistoryService() {
    this.documentHistoryServiceInstance ??= new DocumentHistoryService(this.db, this.userId);

    return this.documentHistoryServiceInstance;
  }

  /**
   * Create a document
   */
  async createDocument(params: {
    content?: string;
    editorData: Record<string, any>;
    fileType?: string;
    knowledgeBaseId?: string;
    metadata?: Record<string, any>;
    parentId?: string;
    rawData?: string;
    slug?: string;
    title: string;
  }): Promise<DocumentItem> {
    const {
      content,
      editorData,
      title,
      fileType = 'custom/document',
      metadata,
      knowledgeBaseId,
      parentId,
      slug,
    } = params;

    // Calculate character and line counts
    const totalCharCount = content?.length || 0;
    const totalLineCount = content?.split('\n').length || 0;

    let fileId: string | null = null;

    // If creating in a knowledge base, create a corresponding file record
    // BUT skip for folders - folders should only exist in the documents table
    if (knowledgeBaseId && fileType !== 'custom/folder') {
      const file = await this.fileModel.create(
        {
          fileType,
          knowledgeBaseId,
          metadata,
          name: title,
          parentId,
          size: totalCharCount,
          url: `internal://document/placeholder`, // Placeholder URL
        },
        false, // Do not insert to global files
      );
      fileId = file.id;
    }

    // Store knowledgeBaseId in metadata for folders (which don't have fileId)
    const finalMetadata =
      knowledgeBaseId && fileType === 'custom/folder' ? { ...metadata, knowledgeBaseId } : metadata;

    const document = await this.documentModel.create({
      content,
      editorData,
      fileId,
      fileType,
      filename: title,
      knowledgeBaseId, // Set knowledge_base_id column for all document types
      metadata: finalMetadata,
      pages: undefined,
      parentId,
      slug,
      source: 'document',
      sourceType: 'api',
      title,
      totalCharCount,
      totalLineCount,
    });

    return document;
  }

  /**
   * Create multiple documents in batch (optimized for folder creation)
   * Returns array of created documents with same order as input
   */
  async createDocuments(
    documents: Array<{
      content?: string;
      editorData: Record<string, any>;
      fileType?: string;
      knowledgeBaseId?: string;
      metadata?: Record<string, any>;
      parentId?: string;
      slug?: string;
      title: string;
    }>,
  ): Promise<DocumentItem[]> {
    // Create all documents in parallel for better performance
    const results = await Promise.all(documents.map((params) => this.createDocument(params)));

    return results;
  }

  /**
   * Query documents with pagination
   */
  async queryDocuments(params?: {
    current?: number;
    fileTypes?: string[];
    pageSize?: number;
    sourceTypes?: string[];
  }) {
    return this.documentModel.query(params);
  }

  /**
   * Get document by ID
   */
  async getDocumentById(id: string) {
    return this.documentModel.findById(id);
  }

  async listDocumentHistory(
    params: ListDocumentHistoryParams,
    options?: DocumentHistoryAccessOptions,
  ): Promise<ListDocumentHistoryResult> {
    return this.documentHistoryService.listDocumentHistory(params, options);
  }

  async getDocumentHistoryItem(
    params: GetDocumentHistoryItemParams,
    options?: DocumentHistoryAccessOptions,
  ) {
    return this.documentHistoryService.getDocumentHistoryItem(params, options);
  }

  async compareDocumentHistoryItems(
    params: CompareDocumentHistoryItemsParams,
    options?: DocumentHistoryAccessOptions,
  ): Promise<CompareDocumentHistoryItemsResult> {
    return this.documentHistoryService.compareDocumentHistoryItems(params, options);
  }

  /**
   * Save a document history snapshot explicitly.
   */
  async saveDocumentHistory(
    documentId: string,
    editorData: Record<string, any>,
    saveSource: DocumentHistorySaveSource,
  ): Promise<SaveDocumentHistoryResult> {
    const currentDocument = await this.documentModel.findById(documentId);
    if (!currentDocument) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const normalizedEditorData = normalizeEditorDataDiffNodes(editorData);
    const savedAt = new Date();
    await this.documentHistoryService.createHistory({
      documentId,
      editorData: normalizedEditorData,
      saveSource,
      savedAt,
    });

    return { savedAt };
  }

  /**
   * Best-effort snapshot of the current document editor state before an automated mutation.
   */
  async trySaveCurrentDocumentHistory(
    documentId: string,
    saveSource: DocumentHistorySaveSource,
  ): Promise<SaveDocumentHistoryResult | undefined> {
    try {
      const currentDocument = await this.documentModel.findById(documentId);
      const editorData = currentDocument?.editorData;
      if (!isValidEditorData(editorData)) return undefined;

      const normalizedEditorData = normalizeEditorDataDiffNodes(editorData);
      const savedAt = new Date();
      await this.documentHistoryService.createHistory({
        documentId,
        editorData: normalizedEditorData,
        saveSource,
        savedAt,
      });

      return { savedAt };
    } catch (error) {
      console.error('[DocumentService] Failed to save current document history:', error);
      return undefined;
    }
  }

  /**
   * Delete document (recursively deletes children if it's a folder)
   */
  async deleteDocument(id: string) {
    const document = await this.documentModel.findById(id);
    if (!document) return;

    // If it's a folder, recursively delete all children first
    if (document.fileType === 'custom/folder') {
      const children = await this.db.query.documents.findMany({
        where: eq(documents.parentId, id),
      });

      // Recursively delete all children
      for (const child of children) {
        await this.deleteDocument(child.id);
      }

      // Also delete all files in this folder
      const childFiles = await this.db.query.files.findMany({
        where: and(eq(files.parentId, id), eq(files.userId, this.userId)),
      });

      for (const file of childFiles) {
        await this.fileModel.delete(file.id);
      }
    }

    // Delete the associated file record if it exists
    if (document.fileId) {
      await this.fileModel.delete(document.fileId);
    }

    // Finally delete the document itself
    return this.documentModel.delete(id);
  }

  /**
   * Delete multiple documents in batch
   */
  async deleteDocuments(ids: string[]) {
    // Delete each document (which handles recursive deletion for folders)
    await Promise.all(ids.map((id) => this.deleteDocument(id)));
  }

  /**
   * Update document
   */
  async updateDocument(id: string, params: UpdateDocumentParams): Promise<UpdateDocumentResult> {
    return this.db.transaction(async (tx) => {
      const transactionDb = tx as unknown as LobeChatDatabase;
      const documentModel = new DocumentModel(transactionDb, this.userId);
      const fileModel = new FileModel(transactionDb, this.userId);
      const documentHistoryService = new DocumentHistoryService(transactionDb, this.userId);

      const currentDocument = await documentModel.findById(id);
      if (!currentDocument) {
        throw new Error(`Document not found: ${id}`);
      }

      // Accepted-view projections used only for historyAppended comparison and
      // for the "before" snapshot written into history. The persisted editorData
      // keeps any pending diff nodes — they're only normalized when the user
      // explicitly accepts/rejects via DiffAllToolbar.
      const currentEditorDataAccepted = normalizeEditorDataDiffNodes(
        (currentDocument.editorData ?? {}) as Record<string, any>,
      );
      const nextEditorDataAccepted =
        params.editorData === undefined
          ? undefined
          : normalizeEditorDataDiffNodes(params.editorData);
      const historyAppended =
        nextEditorDataAccepted !== undefined &&
        !isEqual(nextEditorDataAccepted, currentEditorDataAccepted);

      const updates: Record<string, unknown> = {};

      if (params.content !== undefined) {
        updates.content = params.content;
        updates.totalCharCount = params.content.length;
        updates.totalLineCount = params.content.split('\n').length;
      }

      if (params.editorData !== undefined) {
        updates.editorData = params.editorData;
      }

      if (params.fileType !== undefined) {
        updates.fileType = params.fileType;
      }

      if (params.title !== undefined) {
        updates.title = params.title;
        updates.filename = params.title;
      }

      if (params.metadata !== undefined) {
        updates.metadata = params.metadata;
      }

      if (params.parentId !== undefined) {
        updates.parentId = params.parentId;
      }

      let savedAt: Date | undefined;

      if (historyAppended) {
        savedAt = new Date();
        await documentHistoryService.createHistory({
          documentId: id,
          editorData: currentEditorDataAccepted,
          saveSource: params.saveSource ?? 'autosave',
          savedAt,
        });
      }

      if (Object.keys(updates).length > 0) {
        await documentModel.update(id, updates as Partial<DocumentItem>);
      }

      if ((params.title !== undefined || params.parentId !== undefined) && currentDocument.fileId) {
        const fileUpdates: Record<string, string | null> = {};
        if (params.title !== undefined) fileUpdates.name = params.title;
        if (params.parentId !== undefined) fileUpdates.parentId = params.parentId;
        await fileModel.update(currentDocument.fileId, fileUpdates);
      }

      return {
        historyAppended,
        id,
        savedAt,
      };
    });
  }

  /**
   * Parse file and create a document for page editor (without page tags)
   */
  async parseDocument(fileId: string): Promise<LobeDocument> {
    const { filePath, file, cleanup } = await this.fileService.downloadFileToLocal(fileId);

    const logPrefix = `[${file.name}]`;
    log(`${logPrefix} Starting to parse file as document, path: ${filePath}`);

    try {
      // Use loadFile to load file content
      const fileDocument = await loadFile(filePath);

      log(`${logPrefix} File parsed successfully %O`, {
        fileType: fileDocument.fileType,
        size: fileDocument.content.length,
      });

      // Extract title from metadata or use file name (remove extension)
      const title =
        fileDocument.metadata?.title ||
        file.name.replace(/\.(pdf|docx?|md|markdown)$/i, '') ||
        'Untitled';

      // Clean up content - remove <page> tags if present
      let cleanContent = fileDocument.content;
      if (cleanContent.includes('<page')) {
        cleanContent = cleanContent.replaceAll(/<page[^>]*>([\S\s]*?)<\/page>/g, '$1').trim();
      }

      const document = await this.documentModel.create({
        content: cleanContent,
        fileId,
        fileType: 'custom/document',
        filename: title,
        metadata: fileDocument.metadata,
        parentId: file.parentId,
        source: file.url,
        sourceType: 'file',
        title,
        totalCharCount: cleanContent.length,
        totalLineCount: cleanContent.split('\n').length,
      });

      return document as LobeDocument;
    } catch (error) {
      console.error(`${logPrefix} File parsing failed:`, error);
      throw error;
    } finally {
      cleanup();
    }
  }

  /**
   * Parse file content
   *
   */
  async parseFile(fileId: string): Promise<LobeDocument> {
    // Idempotent: return existing document if already parsed
    const existingDoc = await this.documentModel.findByFileId(fileId);
    if (existingDoc) return existingDoc as LobeDocument;

    const { filePath, file, cleanup } = await this.fileService.downloadFileToLocal(fileId);

    const logPrefix = `[${file.name}]`;
    log(`${logPrefix} Starting to parse file, path: ${filePath}`);

    try {
      // Use loadFile to load file content
      const fileDocument = await loadFile(filePath);

      log(`${logPrefix} File parsed successfully %O`, {
        fileType: fileDocument.fileType,
        size: fileDocument.content.length,
      });

      // Extract title from metadata or use file name (remove extension)
      const title =
        fileDocument.metadata?.title ||
        file.name.replace(/\.(pdf|docx?|md|markdown)$/i, '') ||
        'Untitled';

      const document = await this.documentModel.create({
        content: fileDocument.content,
        fileId,
        fileType: 'custom/document', // Use custom/document for all parsed files
        filename: title,
        metadata: fileDocument.metadata,
        pages: fileDocument.pages,
        parentId: file.parentId,
        source: file.url,
        sourceType: 'file',
        title,
        totalCharCount: fileDocument.totalCharCount,
        totalLineCount: fileDocument.totalLineCount,
      });

      return document as LobeDocument;
    } catch (error) {
      console.error(`${logPrefix} File parsing failed:`, error);
      throw error;
    } finally {
      cleanup();
    }
  }
}
