import { randomUUID } from 'node:crypto';

import { CUSTOM_DOCUMENT_FILE_TYPE, CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { type DocumentItem } from '@lobechat/database/schemas';
import { documents, files } from '@lobechat/database/schemas';
import { loadFile, UnsupportedFileTypeError } from '@lobechat/file-loaders';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { normalizeEditorDataDiffNodes } from '@/libs/editor/normalizeDiffNodes';
import { type LobeDocument } from '@/types/document';

import { EditLockService } from '../editLock';
import { FileService } from '../file';
import { publishResourceEvent } from '../resourceEvents';
import { DocumentHistoryService } from './history';
import type {
  CompareDocumentHistoryItemsParams,
  CompareDocumentHistoryItemsResult,
  DocumentHistoryAccessOptions,
  DocumentHistorySaveSource,
  DocumentLockResult,
  GetDocumentHistoryItemParams,
  ListDocumentHistoryParams,
  ListDocumentHistoryResult,
  SaveDocumentHistoryResult,
  UpdateDocumentParams,
  UpdateDocumentResult,
} from './types';

const log = debug('lobe-chat:service:document');

const normalizeParseFileError = (error: unknown) => {
  if (error instanceof UnsupportedFileTypeError) {
    return new TRPCError({
      cause: error,
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }

  return error;
};

export class DocumentService {
  userId: string;
  private fileModel: FileModel;
  private documentModel: DocumentModel;
  private documentHistoryServiceInstance?: DocumentHistoryService;
  private fileServiceInstance?: FileService;
  private editLockService: EditLockService;
  private db: LobeChatDatabase;

  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.fileModel = new FileModel(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
    this.editLockService = new EditLockService(userId);
  }

  private get fileService() {
    this.fileServiceInstance ??= new FileService(this.db, this.userId, this.workspaceId);

    return this.fileServiceInstance;
  }

  private get documentHistoryService() {
    this.documentHistoryServiceInstance ??= new DocumentHistoryService(
      this.db,
      this.userId,
      this.workspaceId,
    );

    return this.documentHistoryServiceInstance;
  }

  private async deleteFileRecordAndStorage(fileId: string) {
    const file = await this.fileModel.delete(fileId);
    if (!file?.url || file.url.startsWith('internal://')) return;

    await this.fileService.deleteFile(file.url);
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
      fileType = CUSTOM_DOCUMENT_FILE_TYPE,
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
    if (knowledgeBaseId && fileType !== CUSTOM_FOLDER_FILE_TYPE) {
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
      knowledgeBaseId && fileType === CUSTOM_FOLDER_FILE_TYPE
        ? { ...metadata, knowledgeBaseId }
        : metadata;

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

  /**
   * Acquire (or refresh) the collaborative edit lock for a workspace document.
   *
   * Doubles as the heartbeat: an active editor calls this on an interval to keep
   * the lease alive, and a locked-out member calls it to take the lock over once
   * it frees up. Locking only applies in workspace context — personal documents
   * always report as unlocked.
   */
  async acquireDocumentLock(id: string): Promise<DocumentLockResult> {
    return this.acquireDocumentLockWithOwner(id, this.userId);
  }

  async acquireDocumentLockWithOwner(id: string, ownerId: string): Promise<DocumentLockResult> {
    if (!this.workspaceId)
      return { expiresAt: null, holderId: null, lockedByOther: false, ownerId: null };

    const prevHolder = await this.editLockService.getActiveLock('document', id);
    const result = await this.editLockService.acquire('document', id, ownerId);

    // Broadcast only on a holder edge (first claim / takeover). This method also
    // serves the periodic heartbeat, so a steady-state refresh (same holder)
    // must not emit an event.
    if (
      (result.holderId ?? null) !== (prevHolder?.userId ?? null) ||
      (result.ownerId ?? null) !== (prevHolder?.ownerId ?? null)
    ) {
      void publishResourceEvent(
        { id, type: 'document' },
        {
          actorId: this.userId,
          data: {
            expiresAt: result.expiresAt?.toISOString() ?? null,
            holderId: result.holderId,
            ownerId: result.ownerId,
          },
          type: 'lock.changed',
        },
      );
    }

    return result;
  }

  /**
   * Read-only peek of the current edit lock (does not acquire). Lets a client
   * render a workspace page read-only on open when another member holds it.
   */
  async getDocumentLock(id: string, ownerId?: string): Promise<DocumentLockResult> {
    if (!this.workspaceId)
      return { expiresAt: null, holderId: null, lockedByOther: false, ownerId: null };
    const holder = await this.editLockService.getActiveLock('document', id);
    const lockedByOther = holder
      ? holder.ownerId
        ? holder.ownerId !== ownerId
        : holder.userId !== this.userId
      : false;
    return {
      expiresAt: holder?.expiresAt ?? null,
      holderId: holder?.userId ?? null,
      lockedByOther,
      ownerId: holder?.ownerId ?? null,
    };
  }

  /**
   * Release the edit lock if the current user holds it. No-op in personal mode.
   */
  async releaseDocumentLock(id: string): Promise<void> {
    return this.releaseDocumentLockWithOwner(id, this.userId);
  }

  async releaseDocumentLockWithOwner(id: string, ownerId: string): Promise<void> {
    if (!this.workspaceId) return;
    // Only broadcast "unlocked" when we actually released our own lock — if the
    // lease had expired and another member took over, the lock is still held and
    // a bogus holderId:null would wrongly flip their viewers to editable.
    const released = await this.editLockService.release('document', id, ownerId);
    if (!released) return;
    void publishResourceEvent(
      { id, type: 'document' },
      {
        actorId: this.userId,
        data: { expiresAt: null, holderId: null, ownerId: null },
        type: 'lock.changed',
      },
    );
  }

  /**
   * Run a server-initiated read-modify-write (e.g. a Page Agent tool) under the
   * collaborative edit lock. Acquiring the lock up front — rather than only
   * checking it at persist time like {@link updateDocument} — serializes agent
   * writes against other workspace members and rejects when someone else is
   * actively editing, so an agent can no longer silently clobber a human's
   * in-progress edits or another concurrent agent write.
   *
   * No-op in personal mode (no workspace → no collaboration → no lock). When
   * Redis is down the underlying lock degrades to "unlocked" (fail-open), so
   * this never blocks a write.
   */
  async runWithDocumentLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (!this.workspaceId) {
      // Diagnostic: distinguishes "no-op because workspaceId is
      // missing at runtime" from "lock actually evaluated".
      log('runWithDocumentLock skip: no workspaceId (id=%s userId=%s)', id, this.userId);
      return fn();
    }

    // If this user's live editor already holds the lease, ride along on the
    // same ownerId so the acquire below is a pure heartbeat. Stealing the lock
    // with a fresh `server:UUID` would silently rewrite the lease's ownerId,
    // demote the user's saves through the owner-scoped write guard, and on the
    // finally release leave a window where another member could grab the free
    // lock. When we're truly claiming a lock, mint a server-scoped owner id
    // we can identify in release.
    const holderBefore = await this.editLockService.getActiveLock('document', id);
    const heldBeforeByUser = holderBefore?.userId === this.userId;
    const ownerId =
      heldBeforeByUser && holderBefore?.ownerId ? holderBefore.ownerId : `server:${randomUUID()}`;

    const lock = await this.acquireDocumentLockWithOwner(id, ownerId);
    // Diagnostic: surfaces workspaceId/holder/acquire for debugging lock issues.
    log(
      'runWithDocumentLock: id=%s userId=%s ws=%s holderBefore=%s acquired=%o',
      id,
      this.userId,
      this.workspaceId,
      holderBefore?.userId,
      lock,
    );
    if (lock.lockedByOther) {
      throw new TRPCError({
        cause: { data: { code: 'DocumentLocked' } },
        code: 'CONFLICT',
        message: 'Document is being edited by another user',
      });
    }

    try {
      return await fn();
    } finally {
      // Only release a lease we freshly claimed. When the same user already
      // held it, leave their session alive — releasing would briefly flip
      // their editor to read-only and let another member grab the lock in
      // the gap before the next client heartbeat.
      if (!heldBeforeByUser) await this.releaseDocumentLockWithOwner(id, ownerId);
    }
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
    lockOwnerId?: string,
  ): Promise<SaveDocumentHistoryResult> {
    const currentDocument = await this.documentModel.findById(documentId);
    if (!currentDocument) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // Same collaborative edit-lock guard as updateDocument: don't record a
    // history snapshot for a workspace document another member is editing, so a
    // locked-out actor (e.g. a Copilot mutation that will itself be rejected)
    // can't pollute the version timeline. The lock holder forwards its
    // `lockOwnerId` so it can still snapshot its own page (e.g. the pre-mutation
    // snapshot a Copilot edit takes) without being blocked by its own lease.
    if (this.workspaceId) {
      const canWrite = await this.editLockService.canWrite('document', documentId, lockOwnerId);
      if (!canWrite) {
        throw new TRPCError({
          cause: { data: { code: 'DocumentLocked' } },
          code: 'CONFLICT',
          message: 'Document is being edited by another user',
        });
      }
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
    if (document.fileType === CUSTOM_FOLDER_FILE_TYPE) {
      const children = await this.db.query.documents.findMany({
        where: and(
          eq(documents.parentId, id),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
        ),
      });

      // Recursively delete all children
      for (const child of children) {
        await this.deleteDocument(child.id);
      }

      // Also delete all files in this folder
      const childFiles = await this.db.query.files.findMany({
        where: and(
          eq(files.parentId, id),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
        ),
      });

      for (const file of childFiles) {
        await this.deleteFileRecordAndStorage(file.id);
      }
    }

    // Delete the associated file record if it exists
    if (document.fileId) {
      await this.deleteFileRecordAndStorage(document.fileId);
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
    let changed = false;
    const result = await this.db.transaction(async (tx) => {
      const transactionDb = tx as unknown as LobeChatDatabase;
      const documentModel = new DocumentModel(transactionDb, this.userId, this.workspaceId);
      const fileModel = new FileModel(transactionDb, this.userId, this.workspaceId);
      const documentHistoryService = new DocumentHistoryService(
        transactionDb,
        this.userId,
        this.workspaceId,
      );

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

      // Collaborative edit lock guard: reject writes to a workspace document that
      // another member is actively editing, so concurrent edits can't clobber
      // each other. Only the rich-text BODY is locked — metadata-only saves
      // (title/emoji) pass through, since the autosave always re-sends the
      // unchanged body. The lease auto-expires in Redis; when Redis is down this
      // returns null (fail-open) so the lock can't block saving.
      const contentChanged =
        historyAppended ||
        (params.content !== undefined && params.content !== currentDocument.content);
      if (this.workspaceId && contentChanged) {
        const canWrite = await this.editLockService.canWrite('document', id, params.lockOwnerId);
        if (!canWrite) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Document is being edited by another user',
          });
        }
      }

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

      // The lock lease is refreshed by the client heartbeat (acquireDocumentLock),
      // so a save does not need to touch it.

      let savedAt: Date | undefined;

      if (historyAppended) {
        savedAt = new Date();
        await documentHistoryService.createHistory({
          breakAutosaveWindow: params.breakAutosaveWindow,
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

      changed = Object.keys(updates).length > 0 || historyAppended;

      return {
        historyAppended,
        id,
        savedAt,
      };
    });

    // Notify other workspace members that the document changed so their open
    // editor refreshes immediately (best-effort; the heartbeat is the fallback).
    if (this.workspaceId && changed) {
      void publishResourceEvent(
        { id, type: 'document' },
        { actorId: this.userId, type: 'doc.updated' },
      );
    }

    return result;
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
        fileType: CUSTOM_DOCUMENT_FILE_TYPE,
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
      const parseError = normalizeParseFileError(error);
      console.error(`${logPrefix} File parsing failed:`, parseError);
      throw parseError;
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
        fileType: CUSTOM_DOCUMENT_FILE_TYPE, // Use custom/document for all parsed files
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
      const parseError = normalizeParseFileError(error);
      console.error(`${logPrefix} File parsing failed:`, parseError);
      throw parseError;
    } finally {
      cleanup();
    }
  }
}
