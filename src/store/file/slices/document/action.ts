import { createNanoId } from '@lobechat/utils';
import { type SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import { type StoreSetter } from '@/store/types';
import { type LobeDocument } from '@/types/document';
import { DocumentSourceType } from '@/types/document';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';
import { type DocumentQueryFilter } from './initialState';

const n = setNamespace('document');

const ALLOWED_DOCUMENT_SOURCE_TYPES = new Set(['editor', 'file', 'api']);
const ALLOWED_DOCUMENT_FILE_TYPES = new Set(['custom/document', 'application/pdf']);
const EDITOR_DOCUMENT_FILE_TYPE = 'custom/document';

/**
 * Check if a page should be displayed in the page list
 */
const isAllowedDocument = (page: { fileType: string; sourceType: string }) => {
  return (
    ALLOWED_DOCUMENT_SOURCE_TYPES.has(page.sourceType) &&
    ALLOWED_DOCUMENT_FILE_TYPES.has(page.fileType)
  );
};

type Setter = StoreSetter<FileStore>;
export const createDocumentSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new DocumentActionImpl(set, get, _api);

export class DocumentActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

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
      fileType: EDITOR_DOCUMENT_FILE_TYPE,
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      title,
    });

    // Don't refresh pages here - the caller will handle replacing the temp page
    // with the real one via replaceTempDocumentWithReal, which provides a smooth UX
    // without triggering the loading skeleton

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
      fileType: 'custom/folder',
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      slug,
      title: name,
    });

    // Refetch resource list to show the new folder
    const { revalidateResources } = await import('../resource/hooks');
    await revalidateResources();

    return folder.id;
  };

  createOptimisticDocument = (title: string = 'Untitled'): string => {
    const { localDocumentMap } = this.#get();

    // Generate temporary ID with prefix to identify optimistic pages
    const tempId = `temp-document-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();

    const newPage: LobeDocument = {
      content: null,
      createdAt: now,
      editorData: null,
      fileType: EDITOR_DOCUMENT_FILE_TYPE,
      filename: title,
      id: tempId,
      metadata: {},
      source: 'document',
      sourceType: DocumentSourceType.EDITOR,
      title: title,
      totalCharCount: 0,
      totalLineCount: 0,
      updatedAt: now,
    };

    // Add to local map
    const newMap = new Map(localDocumentMap);
    newMap.set(tempId, newPage);
    this.#set({ localDocumentMap: newMap }, false, n('createOptimisticDocument'));

    return tempId;
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

    // Add the new page to local map immediately for instant UI update
    const { localDocumentMap } = this.#get();
    const newMap = new Map(localDocumentMap);
    const editorPage: LobeDocument = {
      content: newPage.content || null,
      createdAt: newPage.createdAt ? new Date(newPage.createdAt) : new Date(),
      editorData:
        typeof newPage.editorData === 'string'
          ? JSON.parse(newPage.editorData)
          : newPage.editorData || null,
      fileType: newPage.fileType,
      filename: newPage.title || newPage.filename || '',
      id: newPage.id,
      metadata: newPage.metadata || {},
      source: 'document',
      sourceType: DocumentSourceType.EDITOR,
      title: newPage.title || '',
      totalCharCount: newPage.content?.length || 0,
      totalLineCount: 0,
      updatedAt: newPage.updatedAt ? new Date(newPage.updatedAt) : new Date(),
    };
    newMap.set(newPage.id, editorPage);
    this.#set({ localDocumentMap: newMap }, false, n('duplicateDocument'));

    // Don't refresh pages here - we've already added it to the local map
    // This prevents the loading skeleton from appearing

    return newPage;
  };

  fetchDocumentDetail = async (documentId: string): Promise<void> => {
    try {
      const document = await documentService.getDocumentById(documentId);

      if (!document) {
        console.warn(`[fetchDocumentDetail] Document not found: ${documentId}`);
        return;
      }

      // Update local map with full document details including editorData
      const { localDocumentMap } = this.#get();
      const newMap = new Map(localDocumentMap);

      const fullDocument: LobeDocument = {
        content: document.content || null,
        createdAt: document.createdAt ? new Date(document.createdAt) : new Date(),
        editorData:
          typeof document.editorData === 'string'
            ? JSON.parse(document.editorData)
            : document.editorData || null,
        fileType: document.fileType,
        filename: document.title || document.filename || 'Untitled',
        id: document.id,
        metadata: document.metadata || {},
        source: 'document',
        sourceType: DocumentSourceType.EDITOR,
        title: document.title || '',
        totalCharCount: document.content?.length || 0,
        totalLineCount: 0,
        updatedAt: document.updatedAt ? new Date(document.updatedAt) : new Date(),
      };

      newMap.set(documentId, fullDocument);
      this.#set({ localDocumentMap: newMap }, false, n('fetchDocumentDetail'));
    } catch (error) {
      console.error('[fetchDocumentDetail] Failed to fetch document:', error);
    }
  };

  fetchDocuments = async ({ pageOnly = false }: { pageOnly?: boolean }): Promise<void> => {
    this.#set({ isDocumentListLoading: true }, false, n('fetchDocuments/start'));

    try {
      const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
      const queryFilters: DocumentQueryFilter | undefined = pageOnly
        ? {
            fileTypes: Array.from(ALLOWED_DOCUMENT_FILE_TYPES),
            sourceTypes: Array.from(ALLOWED_DOCUMENT_SOURCE_TYPES),
          }
        : undefined;

      const queryParams = queryFilters
        ? { current: 0, pageSize, ...queryFilters }
        : { current: 0, pageSize };

      const result = await documentService.queryDocuments(queryParams);

      const pages = result.items.filter(isAllowedDocument).map((doc) => ({
        ...doc,
        filename: doc.filename ?? doc.title ?? 'Untitled',
      })) as LobeDocument[];

      const hasMore = result.items.length >= pageSize;

      this.#set(
        {
          currentPage: 0,
          documentQueryFilter: queryFilters,
          documents: pages,
          documentsTotal: result.total,
          hasMoreDocuments: hasMore,
          isDocumentListLoading: false,
        },
        false,
        n('fetchDocuments/success'),
      );

      // Sync with local map: remove temp pages that now exist on server
      const { localDocumentMap } = this.#get();
      const newMap = new Map(localDocumentMap);

      for (const [id] of localDocumentMap.entries()) {
        if (id.startsWith('temp-document-')) {
          newMap.delete(id);
        }
      }

      this.#set({ localDocumentMap: newMap }, false, n('fetchDocuments/syncLocalMap'));
    } catch (error) {
      console.error('Failed to fetch pages:', error);
      this.#set({ isDocumentListLoading: false }, false, n('fetchDocuments/error'));
      throw error;
    }
  };

  getOptimisticDocuments = (): LobeDocument[] => {
    const { localDocumentMap, documents } = this.#get();

    // Track which pages we've added
    const addedIds = new Set<string>();

    // Create result array - start with server pages
    const result: LobeDocument[] = documents.map((page) => {
      addedIds.add(page.id);
      // Check if we have a local optimistic update for this page
      const localUpdate = localDocumentMap.get(page.id);
      // If local update exists and is newer, use it; otherwise use server version
      if (localUpdate && new Date(localUpdate.updatedAt) >= new Date(page.updatedAt)) {
        return localUpdate;
      }
      return page;
    });

    // Add any optimistic pages that aren't in server list yet (e.g., newly created temp pages)
    for (const [id, page] of localDocumentMap.entries()) {
      if (!addedIds.has(id)) {
        result.unshift(page); // Add new pages to the beginning
      }
    }

    return result;
  };

  loadMoreDocuments = async (): Promise<void> => {
    const { currentPage, isLoadingMoreDocuments, hasMoreDocuments, documentQueryFilter } =
      this.#get();

    if (isLoadingMoreDocuments || !hasMoreDocuments) return;

    const nextPage = currentPage + 1;

    this.#set({ isLoadingMoreDocuments: true }, false, n('loadMoreDocuments/start'));

    try {
      const pageSize = useGlobalStore.getState().status.pagePageSize || 20;
      const queryParams = documentQueryFilter
        ? { current: nextPage, pageSize, ...documentQueryFilter }
        : { current: nextPage, pageSize };

      const result = await documentService.queryDocuments(queryParams);

      const newPages = result.items.filter(isAllowedDocument).map((doc) => ({
        ...doc,
        filename: doc.filename ?? doc.title ?? 'Untitled',
      })) as LobeDocument[];

      const hasMore = result.items.length >= pageSize;

      this.#set(
        {
          currentPage: nextPage,
          documents: [...this.#get().documents, ...newPages],
          documentsTotal: result.total,
          hasMoreDocuments: hasMore,
          isLoadingMoreDocuments: false,
        },
        false,
        n('loadMoreDocuments/success'),
      );
    } catch (error) {
      console.error('Failed to load more pages:', error);
      this.#set({ isLoadingMoreDocuments: false }, false, n('loadMoreDocuments/error'));
    }
  };

  removeDocument = async (documentId: string): Promise<void> => {
    // Remove from local optimistic map first (optimistic update)
    const { localDocumentMap, documents } = this.#get();
    const newMap = new Map(localDocumentMap);
    newMap.delete(documentId);

    // Also remove from documents array to update the list immediately
    const newDocuments = documents.filter((doc) => doc.id !== documentId);

    this.#set(
      { documents: newDocuments, localDocumentMap: newMap },
      false,
      n('removeDocument/optimistic'),
    );

    try {
      // Delete from documents table
      await documentService.deleteDocument(documentId);
      // No need to call fetchDocuments() - optimistic update is enough
    } catch (error) {
      console.error('Failed to delete document:', error);
      // Restore the document in local map and documents array on error
      const restoredMap = new Map(localDocumentMap);
      this.#set(
        {
          documents,
          localDocumentMap: restoredMap,
        },
        false,
        n('removeDocument/restore'),
      );
      throw error;
    }
  };

  removeTempDocument = (tempId: string): void => {
    const { localDocumentMap } = this.#get();
    const newMap = new Map(localDocumentMap);
    newMap.delete(tempId);
    this.#set({ localDocumentMap: newMap }, false, n('removeTempDocument'));
  };

  replaceTempDocumentWithReal = (tempId: string, realPage: LobeDocument): void => {
    const { localDocumentMap } = this.#get();
    const newMap = new Map(localDocumentMap);

    // Remove temp page
    newMap.delete(tempId);

    // Add real page with same position
    newMap.set(realPage.id, realPage);

    this.#set({ localDocumentMap: newMap }, false, n('replaceTempDocumentWithReal'));
  };

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

    // Refetch resource list to show updated document
    const { revalidateResources } = await import('../resource/hooks');
    await revalidateResources();
  };

  updateDocumentOptimistically = async (
    documentId: string,
    updates: Partial<LobeDocument>,
  ): Promise<void> => {
    const { localDocumentMap, documents } = this.#get();

    // Find the page either in local map or documents state
    let existingPage = localDocumentMap.get(documentId);
    if (!existingPage) {
      existingPage = documents.find((doc) => doc.id === documentId);
    }

    if (!existingPage) {
      console.warn('[updateDocumentOptimistically] Page not found:', documentId);
      return;
    }

    // Create updated page with new timestamp
    // Merge metadata if both exist, otherwise use the update's metadata or preserve existing
    const mergedMetadata =
      updates.metadata !== undefined
        ? { ...existingPage.metadata, ...updates.metadata }
        : existingPage.metadata;

    // Clean up undefined values from metadata
    const cleanedMetadata = mergedMetadata
      ? Object.fromEntries(Object.entries(mergedMetadata).filter(([, v]) => v !== undefined))
      : {};

    const updatedPage: LobeDocument = {
      ...existingPage,
      ...updates,
      metadata: cleanedMetadata,
      title: updates.title || existingPage.title,
      updatedAt: new Date(),
    };

    // Update local map immediately for optimistic UI
    const newMap = new Map(localDocumentMap);
    newMap.set(documentId, updatedPage);
    this.#set({ localDocumentMap: newMap }, false, n('updateDocumentOptimistically'));

    // Queue background sync to DB
    try {
      await documentService.updateDocument({
        content: updatedPage.content || '',
        editorData:
          typeof updatedPage.editorData === 'string'
            ? updatedPage.editorData
            : JSON.stringify(updatedPage.editorData || {}),
        id: documentId,
        metadata: updatedPage.metadata || {},
        parentId: updatedPage.parentId || undefined,
        title: updatedPage.title || updatedPage.filename,
      });

      // After successful sync, refetch resources to get server state
      const { revalidateResources } = await import('../resource/hooks');
      await revalidateResources();
    } catch (error) {
      console.error('[updateDocumentOptimistically] Failed to sync to DB:', error);
      // On error, revert the optimistic update
      const revertMap = new Map(localDocumentMap);
      if (existingPage) {
        revertMap.set(documentId, existingPage);
      } else {
        revertMap.delete(documentId);
      }
      this.#set({ localDocumentMap: revertMap }, false, n('revertOptimisticUpdate'));
    }
  };

  useFetchDocumentDetail = (documentId: string | undefined): SWRResponse<LobeDocument | null> => {
    const swrKey = documentId ? ['documentDetail', documentId] : null;

    return useClientDataSWRWithSync<LobeDocument | null>(
      swrKey,
      async () => {
        if (!documentId) return null;

        const document = await documentService.getDocumentById(documentId);
        if (!document) {
          console.warn(`[useFetchDocumentDetail] Document not found: ${documentId}`);
          return null;
        }

        // Transform API response to LobeDocument format
        const fullDocument: LobeDocument = {
          content: document.content || null,
          createdAt: document.createdAt ? new Date(document.createdAt) : new Date(),
          editorData:
            typeof document.editorData === 'string'
              ? JSON.parse(document.editorData)
              : document.editorData || null,
          fileType: document.fileType,
          filename: document.title || document.filename || 'Untitled',
          id: document.id,
          metadata: document.metadata || {},
          source: 'document',
          sourceType: DocumentSourceType.EDITOR,
          title: document.title || '',
          totalCharCount: document.content?.length || 0,
          totalLineCount: 0,
          updatedAt: document.updatedAt ? new Date(document.updatedAt) : new Date(),
        };

        return fullDocument;
      },
      {
        focusThrottleInterval: 5000,
        onData: (document) => {
          if (!document) return;

          // Auto-sync to localDocumentMap
          const { localDocumentMap } = this.#get();
          const newMap = new Map(localDocumentMap);
          newMap.set(documentId!, document);
          this.#set({ localDocumentMap: newMap }, false, n('useFetchDocumentDetail/onData'));
        },
        revalidateOnFocus: true, // 5 seconds
      },
    );
  };
}

export type DocumentAction = Pick<DocumentActionImpl, keyof DocumentActionImpl>;
