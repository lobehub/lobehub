import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { type DocumentItem } from '@lobechat/database/schemas';
import { createNanoId } from '@lobechat/utils';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { documentService } from '@/services/document';
import { type StoreSetter } from '@/store/types';
import { type LobeDocument } from '@/types/document';
import { DocumentSourceType } from '@/types/document';
import { type ResourceItem } from '@/types/resource';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore, useFileStore } from '../../store';
import { getResourceQueryKey } from '../resource/utils';
import { type FileDocumentDetail, fileDocumentResource } from './projection';

const n = setNamespace('document');

type Setter = StoreSetter<FileStore>;

/**
 * Result of {@link DocumentActionImpl.useFetchDocumentDetail}.
 *
 * `data` is the replica view, read from the store (not from the hook's return)
 * so the first frame paints from the persisted projection and the network only
 * confirms it: `undefined` = nothing loaded for this id yet, `null` = the
 * server answered "not found".
 */
export interface UseFetchDocumentDetailResult {
  data: LobeDocument | null | undefined;
  error: unknown;
  /** SWR's `isLoading` semantics: no value yet and no error. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-run the network sync for this document. */
  mutate: () => Promise<unknown>;
}

/**
 * Shape the resource explorer merges onto its list rows. Kept separate from
 * `LobeDocument`: a list row also needs the library it belongs to, which the
 * document row itself does not carry.
 */
interface ResourceDocumentSnapshot {
  content?: string | null;
  createdAt?: Date | string;
  editorData?: LobeDocument['editorData'] | string;
  fileType?: string;
  id: string;
  knowledgeBaseId?: string;
  metadata?: LobeDocument['metadata'] | null;
  parentId?: string | null;
  slug?: string | null;
  source?: string | null;
  title?: string | null;
  totalCharCount?: number;
  updatedAt?: Date | string;
}

export const createDocumentSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new DocumentActionImpl(set, get, _api);

export class DocumentActionImpl {
  readonly #get: () => FileStore;
  /**
   * One document row per id. The replica owns every transition of `documentMap`
   * (hydrate → first frame, server replace, optimistic rename, delete).
   */
  readonly #documents;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#documents = createReplicaSlice(fileDocumentResource, {
      actionPrefix: n('fileDocument'),
      fetcher: async (id) => {
        const row = await documentService.getDocumentById(id);

        return { document: row ? this.#toLobeDocument(row) : null };
      },
      get,
      set,
      stateKey: 'fileDocumentReplica',
      // A "not found" answer is a page state, not a document — never persist it.
      toPersisted: (data) => (data.document ? data : undefined),
      view: recordLens<FileStore, FileDocumentDetail>('documentMap'),
    });
  }

  /**
   * Normalize a server row into the store's document shape. Kept in one place so
   * the sync path and the create/duplicate paths produce the same entry.
   */
  #toLobeDocument = (row: DocumentItem): LobeDocument => ({
    content: row.content || null,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    editorData:
      typeof row.editorData === 'string' ? JSON.parse(row.editorData) : (row.editorData ?? null),
    fileType: row.fileType,
    filename: row.title || row.filename || 'Untitled',
    id: row.id,
    metadata: row.metadata || {},
    source: 'document',
    sourceType: DocumentSourceType.EDITOR,
    title: row.title || '',
    totalCharCount: row.content?.length || 0,
    totalLineCount: 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  });

  /** The resource-explorer snapshot of a server row (carries its library). */
  #toResourceSnapshot = (
    row: DocumentItem,
    knowledgeBaseId?: string,
  ): ResourceDocumentSnapshot => ({
    content: row.content,
    createdAt: row.createdAt,
    editorData: row.editorData,
    fileType: row.fileType,
    id: row.id,
    knowledgeBaseId,
    metadata: row.metadata,
    parentId: row.parentId,
    slug: row.slug,
    source: row.source,
    title: row.title,
    totalCharCount: row.totalCharCount,
    updatedAt: row.updatedAt,
  });

  #normalizeDate = (value: Date | string | undefined, fallback: Date) => {
    return value ? new Date(value) : fallback;
  };

  #parseEditorData = (
    editorData: LobeDocument['editorData'] | string | undefined,
    fallback: ResourceItem['editorData'],
  ): ResourceItem['editorData'] => {
    if (editorData === undefined) return fallback;
    if (editorData === null) return null;

    return typeof editorData === 'string' ? JSON.parse(editorData) : editorData;
  };

  #createUpdatedDocument = (
    existingDocument: LobeDocument,
    updates: Partial<LobeDocument>,
  ): LobeDocument => {
    const mergedMetadata =
      updates.metadata !== undefined
        ? { ...existingDocument.metadata, ...updates.metadata }
        : existingDocument.metadata;

    const cleanedMetadata = mergedMetadata
      ? Object.fromEntries(Object.entries(mergedMetadata).filter(([, v]) => v !== undefined))
      : {};

    return {
      ...existingDocument,
      ...updates,
      metadata: cleanedMetadata,
      title: updates.title || existingDocument.title,
      updatedAt: new Date(),
    };
  };

  /**
   * Whether `resource` belongs in the explorer's current list.
   *
   * `keepWhenUnknown` is for rows that are ALREADY in the list: `file.getKnowledgeItems`
   * rows carry neither `knowledgeBaseId` nor `parentId`, so a title/emoji save merged
   * onto such a row cannot prove the row moved out of the current library/folder.
   * Treating "unknown" as "elsewhere" dropped the page from the explorer (and the
   * sidebar tree that mirrors it) on every autosave.
   */
  #isResourceVisibleInCurrentQuery = (
    resource: ResourceItem,
    options?: { keepWhenUnknown?: boolean },
  ): boolean => {
    const { queryParams, resourceMap } = this.#get();
    const keepWhenUnknown = options?.keepWhenUnknown ?? false;

    if (!queryParams) return false;

    if (
      queryParams.libraryId !== undefined &&
      !(keepWhenUnknown && resource.knowledgeBaseId === undefined) &&
      (resource.knowledgeBaseId ?? undefined) !== queryParams.libraryId
    ) {
      return false;
    }

    const keyword = queryParams.q?.trim().toLowerCase();
    if (keyword) {
      const candidate = `${resource.name} ${resource.title ?? ''}`.trim().toLowerCase();
      if (!candidate.includes(keyword)) return false;
    }

    if (queryParams.parentId == null) {
      return (resource.parentId ?? null) === null;
    }

    if (resource.parentId === undefined && keepWhenUnknown) return true;
    if (!resource.parentId) return false;
    if (resource.parentId === queryParams.parentId) return true;

    const parentResource = resourceMap.get(resource.parentId);
    return parentResource?.slug === queryParams.parentId;
  };

  #createResourceItem = (
    document: ResourceDocumentSnapshot,
    fallback?: ResourceItem,
    options?: { optimistic?: boolean },
  ): ResourceItem => {
    const optimistic = options?.optimistic ?? false;
    const now = new Date();

    return {
      ...fallback,
      _optimistic: optimistic
        ? {
            error: fallback?._optimistic?.error,
            isPending: true,
            lastSyncAttempt: fallback?._optimistic?.lastSyncAttempt,
            queryKey: getResourceQueryKey(this.#get().queryParams),
            retryCount: fallback?._optimistic?.retryCount ?? 0,
          }
        : undefined,
      content: document.content !== undefined ? document.content : (fallback?.content ?? null),
      createdAt: this.#normalizeDate(document.createdAt, fallback?.createdAt ?? now),
      editorData: this.#parseEditorData(document.editorData, fallback?.editorData),
      fileType: document.fileType ?? fallback?.fileType ?? CUSTOM_DOCUMENT_FILE_TYPE,
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId ?? fallback?.knowledgeBaseId,
      metadata: document.metadata ?? fallback?.metadata,
      name:
        document.title !== undefined
          ? (document.title ?? 'Untitled')
          : (fallback?.name ?? fallback?.title ?? 'Untitled'),
      // Keep `undefined` when neither side knows the parent: list rows omit it, and
      // coercing to `null` would misreport a folder child as a root item.
      parentId: document.parentId !== undefined ? document.parentId : fallback?.parentId,
      size: document.totalCharCount ?? fallback?.size ?? document.content?.length ?? 0,
      slug: document.slug !== undefined ? document.slug : fallback?.slug,
      sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
      title:
        document.title !== undefined
          ? (document.title ?? undefined)
          : (fallback?.title ?? undefined),
      updatedAt: this.#normalizeDate(document.updatedAt, fallback?.updatedAt ?? now),
      url: document.source !== undefined ? (document.source ?? '') : (fallback?.url ?? ''),
    };
  };

  #syncResourceItem = (resource: ResourceItem, options?: { allowInsert?: boolean }) => {
    const { queryParams, removeLocalResource, replaceLocalResource, resourceList, resourceMap } =
      this.#get();
    const exists =
      resourceMap.has(resource.id) || resourceList.some((item) => item.id === resource.id);

    if (exists) {
      if (
        !queryParams ||
        this.#isResourceVisibleInCurrentQuery(resource, { keepWhenUnknown: true })
      ) {
        replaceLocalResource(resource.id, resource);
      } else {
        removeLocalResource(resource.id);
      }

      return;
    }

    if (options?.allowInsert === false || !queryParams) return;
    if (!this.#isResourceVisibleInCurrentQuery(resource)) return;

    replaceLocalResource(resource.id, resource);
  };

  createDocument = async ({
    title,
    content,
    knowledgeBaseId,
    parentId,
  }: {
    content: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
  }): Promise<{ [key: string]: any; id: string }> => {
    const now = Date.now();

    // Create page with markdown content, leave editorData as empty JSON object
    const newPage = await documentService.createDocument({
      content,
      editorData: '{}', // Empty JSON object instead of empty string
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      title,
    });

    // Hold the row in the replica so the page can be opened (and re-opened from
    // a reload) without another round trip; the explorer list is fed from the
    // resource slice.
    this.#documents.replace(newPage.id, { document: this.#toLobeDocument(newPage) });
    this.#syncResourceItem(
      this.#createResourceItem(this.#toResourceSnapshot(newPage, knowledgeBaseId)),
    );

    return newPage;
  };

  createFolder = async (
    name: string,
    parentId?: string,
    knowledgeBaseId?: string,
  ): Promise<string> => {
    const now = Date.now();

    // Generate random 8-character slug (A-Z, a-z, 0-9)
    const generateSlug = createNanoId(8);
    const slug = generateSlug();

    const folder = await documentService.createDocument({
      content: '',
      editorData: '{}',
      fileType: CUSTOM_FOLDER_FILE_TYPE,
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      slug,
      title: name,
    });

    this.#documents.replace(folder.id, { document: this.#toLobeDocument(folder) });
    this.#syncResourceItem(
      this.#createResourceItem(this.#toResourceSnapshot(folder, knowledgeBaseId)),
    );

    return folder.id;
  };

  duplicateDocument = async (documentId: string): Promise<{ [key: string]: any; id: string }> => {
    // Fetch the source page
    const sourcePage = await documentService.getDocumentById(documentId);

    if (!sourcePage) {
      throw new Error(`Page with ID ${documentId} not found`);
    }

    // Create a new page with copied properties
    const newPage = await documentService.createDocument({
      content: sourcePage.content || '',
      editorData: sourcePage.editorData
        ? typeof sourcePage.editorData === 'string'
          ? sourcePage.editorData
          : JSON.stringify(sourcePage.editorData)
        : '{}',
      fileType: sourcePage.fileType,
      metadata: {
        ...sourcePage.metadata,
        createdAt: Date.now(),
        duplicatedFrom: documentId,
      },
      title: `${sourcePage.title} (Copy)`,
    });

    // Make the copy openable immediately: the replica entry is what
    // `getDocumentById` resolves, so the editor does not wait on a refetch.
    this.#documents.replace(newPage.id, { document: this.#toLobeDocument(newPage) });

    return newPage;
  };

  /**
   * Keep the client's document row in step with the server, without a list
   * refetch: the replica entry is the single cache the resource manager reads.
   */
  updateDocument = async (id: string, updates: Partial<LobeDocument>): Promise<void> => {
    await documentService.updateDocument({
      content: updates.content ?? undefined,
      editorData: updates.editorData
        ? typeof updates.editorData === 'string'
          ? updates.editorData
          : JSON.stringify(updates.editorData)
        : undefined,
      id,
      metadata: updates.metadata,
      parentId: updates.parentId !== undefined ? updates.parentId : undefined,
      title: updates.title,
    });

    const existingDocument = this.#get().documentMap[id]?.document;

    if (existingDocument) {
      const updatedDocument = this.#createUpdatedDocument(existingDocument, updates);
      this.#documents.replace(id, { document: updatedDocument });
      this.#syncResourceItem(
        this.#createResourceItem(updatedDocument, this.#get().resourceMap.get(id)),
      );
      return;
    }

    const existingResource = this.#get().resourceMap.get(id);
    if (!existingResource) return;

    this.#syncResourceItem(
      this.#createResourceItem(
        {
          content: updates.content,
          editorData: updates.editorData,
          fileType: existingResource.fileType,
          id,
          metadata: updates.metadata,
          parentId: updates.parentId,
          title: updates.title,
          updatedAt: new Date(),
        },
        existingResource,
      ),
    );
  };

  /**
   * Rename / re-emoji a document: show it at once, write through, and put the
   * previous value back if the write fails. Also mirrors the change onto the
   * explorer row, which is what the user is actually looking at.
   */
  updateDocumentOptimistically = async (
    documentId: string,
    updates: Partial<LobeDocument>,
  ): Promise<void> => {
    const existingDocument = this.#get().documentMap[documentId]?.document;

    if (!existingDocument) {
      console.warn('[updateDocumentOptimistically] Document not found:', documentId);
      return;
    }

    const existingResource = this.#get().resourceMap.get(documentId);
    const updatedDocument = this.#createUpdatedDocument(existingDocument, updates);

    // Optimistic overlay: the view shows the new value until the DB confirms it.
    const token = this.#documents.beginOptimistic(documentId, () => ({
      document: updatedDocument,
    }));

    if (existingResource) {
      this.#syncResourceItem(
        this.#createResourceItem(updatedDocument, existingResource, { optimistic: true }),
      );
    }

    try {
      await documentService.updateDocument({
        id: documentId,
        metadata: updatedDocument.metadata || {},
        parentId: updatedDocument.parentId !== undefined ? updatedDocument.parentId : undefined,
        title: updatedDocument.title || updatedDocument.filename,
        ...(updates.content === undefined ? {} : { content: updatedDocument.content ?? '' }),
        ...(updates.editorData === undefined
          ? {}
          : {
              editorData:
                typeof updatedDocument.editorData === 'string'
                  ? updatedDocument.editorData
                  : JSON.stringify(updatedDocument.editorData || {}),
            }),
      });

      token.commit();

      if (existingResource) {
        this.#syncResourceItem(this.#createResourceItem(updatedDocument, existingResource));
      }
    } catch (error) {
      console.error('[updateDocumentOptimistically] Failed to sync to DB:', error);
      // Put the previous row back; the explorer row follows the same value.
      token.rollback();

      if (existingResource) {
        this.#syncResourceItem(existingResource);
      }
    }
  };

  removeDocument = async (documentId: string): Promise<void> => {
    // Drop the row optimistically; restore it if the server rejects the delete.
    const snapshot = this.#get().documentMap[documentId];
    this.#documents.remove(documentId);

    try {
      await documentService.deleteDocument(documentId);
    } catch (error) {
      console.error('Failed to delete document:', error);
      if (snapshot) this.#documents.replace(documentId, snapshot);
      throw error;
    }
  };

  /**
   * Warm the replica for a document the user is about to open, so the resource
   * manager paints from the projection (and a later reload hydrates it) instead
   * of waiting on the network.
   */
  prefetchDocument = async (documentId: string): Promise<void> => {
    try {
      const row = await documentService.getDocumentById(documentId);
      this.#documents.replace(documentId, {
        document: row ? this.#toLobeDocument(row) : null,
      });
    } catch (error) {
      console.error('[FileStore] Failed to prefetch document:', error);
    }
  };

  /**
   * Sync one document through its replica. The view is the source of truth, so
   * a reload or a return to the route paints from the persisted projection on
   * the first frame and the network only confirms it.
   */
  useFetchDocumentDetail = (documentId: string | undefined): UseFetchDocumentDetailResult => {
    const entry = useFileStore((s) => (documentId ? s.documentMap[documentId] : undefined));

    const sync = this.#documents.useSync(documentId, {
      // Keep an open page in step with other writers.
      revalidateOnFocus: true,
    });

    return {
      data: entry?.document,
      error: sync.error,
      isLoading: Boolean(documentId) && entry === undefined && sync.error == null,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    };
  };
}

export type DocumentAction = Pick<DocumentActionImpl, keyof DocumentActionImpl>;
