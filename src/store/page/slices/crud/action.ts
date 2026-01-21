import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { DocumentSourceType, type LobeDocument } from '@/types/document';
import { standardizeIdentifier } from '@/utils/identifier';
import { setNamespace } from '@/utils/storeDebug';

import { type PageStore } from '../../store';

const n = setNamespace('page/crud');

const EDITOR_PAGE_FILE_TYPE = 'custom/document';

/**
 * Page update parameters - flattened for easier use
 */
export interface PageUpdateParams {
  emoji?: string;
  title?: string;
}

export interface CrudAction {
  /**
   * Create a new page with optimistic update (for page explorer)
   */
  createNewPage: (title: string) => Promise<string>;
  /**
   * Create a new optimistic page immediately in documents array
   */
  createOptimisticPage: (title?: string) => string;
  /**
   * Create a new page with markdown content (not optimistic, waits for server response)
   */
  createPage: (params: {
    content?: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
  }) => Promise<{ [key: string]: any; id: string }>;
  /**
   * Delete a page and update selection if needed
   */
  deletePage: (pageId: string) => Promise<void>;
  /**
   * Duplicate an existing page
   */
  duplicatePage: (pageId: string) => Promise<{ [key: string]: any; id: string }>;
  navigateToPage: (pageId: string | null) => void;
  /**
   * Remove a page (deletes from documents table)
   */
  removePage: (pageId: string) => Promise<void>;
  /**
   * Remove a temp page from documents array
   */
  removeTempPage: (tempId: string) => void;
  /**
   * Rename a page
   */
  renamePage: (pageId: string, title: string, emoji?: string) => Promise<void>;
  /**
   * Replace a temp page with real page data
   */
  replaceTempPageWithReal: (tempId: string, realPage: LobeDocument) => void;
  /**
   * Update page directly (no optimistic update)
   */
  updatePage: (pageId: string, updates: Partial<LobeDocument>) => Promise<void>;
  /**
   * Optimistically update page in documents array and queue for DB sync
   */
  updatePageOptimistically: (pageId: string, updates: PageUpdateParams) => Promise<void>;
  /**
   * SWR hook to fetch page detail with caching and auto-sync to store
   */
  useFetchPageDetail: (pageId: string | undefined) => SWRResponse<LobeDocument | null>;
}

export const createCrudSlice: StateCreator<
  PageStore,
  [['zustand/devtools', never]],
  [],
  CrudAction
> = (set, get) => ({
  createNewPage: async (title: string) => {
    const { createOptimisticPage, createPage, replaceTempPageWithReal } = get();

    // Create optimistic page immediately
    const tempPageId = createOptimisticPage(title);
    set({ isCreatingNew: true, selectedPageId: tempPageId }, false, n('createNewPage/start'));

    try {
      // Create real page
      const newPage = await createPage({ content: '', title });

      // Convert to LobeDocument
      const realPage: LobeDocument = {
        content: newPage.content || '',
        createdAt: newPage.createdAt ? new Date(newPage.createdAt) : new Date(),
        editorData:
          typeof newPage.editorData === 'string'
            ? JSON.parse(newPage.editorData)
            : newPage.editorData || null,
        fileType: 'custom/document',
        filename: newPage.title || title,
        id: newPage.id,
        metadata: newPage.metadata || {},
        source: 'document',
        sourceType: DocumentSourceType.EDITOR,
        title: newPage.title || title,
        totalCharCount: newPage.content?.length || 0,
        totalLineCount: 0,
        updatedAt: newPage.updatedAt ? new Date(newPage.updatedAt) : new Date(),
      };

      // Replace optimistic with real
      replaceTempPageWithReal(tempPageId, realPage);
      set({ isCreatingNew: false, selectedPageId: newPage.id }, false, n('createNewPage/success'));

      // Navigate to the new page
      get().navigateToPage(newPage.id);

      return newPage.id;
    } catch (error) {
      console.error('Failed to create page:', error);
      get().removeTempPage(tempPageId);
      set({ isCreatingNew: false, selectedPageId: null }, false, n('createNewPage/error'));
      get().navigate?.('/page');

      throw error;
    }
  },
  createOptimisticPage: (title = 'Untitled') => {
    // Generate temporary ID with prefix to identify optimistic pages
    const tempId = `temp-page-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();

    const newPage: LobeDocument = {
      content: null,
      createdAt: now,
      editorData: null,
      fileType: EDITOR_PAGE_FILE_TYPE,
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

    // Add to documents array via internal dispatch
    get().internal_dispatchDocuments({ document: newPage, type: 'addDocument' });

    return tempId;
  },

  createPage: async ({ title, content = '', knowledgeBaseId, parentId }) => {
    const now = Date.now();

    const newPage = await documentService.createDocument({
      content,
      editorData: '{}',
      fileType: EDITOR_PAGE_FILE_TYPE,
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      title,
    });

    return newPage;
  },

  deletePage: async (pageId: string) => {
    const { selectedPageId } = get();

    if (selectedPageId === pageId) {
      set({ isCreatingNew: false, selectedPageId: null }, false, n('deletePage'));
      get().navigateToPage(null);
    }
  },

  duplicatePage: async (pageId) => {
    // Fetch the source page
    const sourcePage = await documentService.getDocumentById(pageId);

    if (!sourcePage) {
      throw new Error(`Page with ID ${pageId} not found`);
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
        duplicatedFrom: pageId,
      },
      title: `${sourcePage.title} (Copy)`,
    });

    // Add the new page to documents array via internal dispatch
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

    get().internal_dispatchDocuments({ document: editorPage, type: 'addDocument' });

    return newPage;
  },

  navigateToPage: (pageId) => {
    if (!pageId) {
      get().navigate?.('/page');
    } else {
      get().navigate?.(`/page/${standardizeIdentifier(pageId)}`);
    }
  },

  removePage: async (pageId) => {
    const { documents, selectedPageId } = get();

    // Store original documents for rollback
    const originalDocuments = documents;

    // Remove from documents array via internal dispatch (optimistic update)
    get().internal_dispatchDocuments({ id: pageId, type: 'removeDocument' });

    // Clear selected page ID if the deleted page is currently selected
    if (selectedPageId === pageId) {
      set({ selectedPageId: null }, false, n('removePage/clearSelection'));
      get().navigateToPage(null);
    }

    try {
      // Delete from documents table
      await documentService.deleteDocument(pageId);
    } catch (error) {
      console.error('Failed to delete page:', error);
      // Restore documents on error
      if (originalDocuments) {
        get().internal_dispatchDocuments({ documents: originalDocuments, type: 'setDocuments' });
      }
      if (selectedPageId === pageId) {
        set({ selectedPageId: pageId }, false, n('removePage/restoreSelection'));
        get().navigateToPage(pageId);
      }
      throw error;
    }
  },

  removeTempPage: (tempId) => {
    get().internal_dispatchDocuments({ id: tempId, type: 'removeDocument' });
  },

  renamePage: async (pageId: string, title: string, emoji?: string) => {
    const { updatePageOptimistically } = get();

    try {
      await updatePageOptimistically(pageId, { emoji, title });
    } catch (error) {
      console.error('Failed to rename page:', error);
    } finally {
      set({ renamingPageId: null }, false, n('renamePage'));
    }
  },

  replaceTempPageWithReal: (tempId, realPage) => {
    get().internal_dispatchDocuments({
      document: realPage,
      oldId: tempId,
      type: 'replaceDocument',
    });
  },

  updatePage: async (id, updates) => {
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
    await get().refreshDocuments();
  },

  updatePageOptimistically: async (pageId, updates) => {
    const { documents } = get();

    // Find the page in documents array
    const existingPage = documents?.find((doc) => doc.id === pageId);

    if (!existingPage) {
      console.warn('[updatePageOptimistically] Page not found:', pageId);
      return;
    }

    // Build updated metadata with emoji
    const updatedMetadata = {
      ...existingPage.metadata,
      ...(updates.emoji !== undefined ? { emoji: updates.emoji } : {}),
    };

    // Clean up undefined values from metadata
    const cleanedMetadata = Object.fromEntries(
      Object.entries(updatedMetadata).filter(([, v]) => v !== undefined),
    );

    const updatedPage: LobeDocument = {
      ...existingPage,
      metadata: cleanedMetadata,
      title: updates.title ?? existingPage.title,
      updatedAt: new Date(),
    };

    // Update documents array via internal dispatch (optimistic)
    get().internal_dispatchDocuments({ document: updatedPage, id: pageId, type: 'updateDocument' });

    // Queue background sync to DB
    try {
      await documentService.updateDocument({
        content: updatedPage.content || '',
        editorData:
          typeof updatedPage.editorData === 'string'
            ? updatedPage.editorData
            : JSON.stringify(updatedPage.editorData || {}),
        id: pageId,
        metadata: updatedPage.metadata || {},
        parentId: updatedPage.parentId || undefined,
        title: updatedPage.title || updatedPage.filename,
      });

      // After successful sync, refresh document list to get server state
      await get().refreshDocuments();
    } catch (error) {
      console.error('[updatePageOptimistically] Failed to sync to DB:', error);
      // On error, revert by restoring original page
      get().internal_dispatchDocuments({
        document: existingPage,
        id: pageId,
        type: 'updateDocument',
      });
    }
  },

  useFetchPageDetail: (pageId) => {
    const swrKey = pageId ? ['pageDetail', pageId] : null;

    return useClientDataSWRWithSync<LobeDocument | null>(
      swrKey,
      async () => {
        if (!pageId) return null;

        const document = await documentService.getDocumentById(pageId);
        if (!document) {
          console.warn(`[useFetchPageDetail] Page not found: ${pageId}`);
          return null;
        }

        // Transform API response to LobeDocument format
        const fullPage: LobeDocument = {
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

        return fullPage;
      },
      {
        focusThrottleInterval: 5000,
        onData: (document) => {
          if (!document || !pageId) return;

          // Auto-sync to documents array via internal dispatch
          const { documents } = get();
          if (documents?.some((doc) => doc.id === pageId)) {
            get().internal_dispatchDocuments({ document, id: pageId, type: 'updateDocument' });
          }
        },
        revalidateOnFocus: true,
      },
    );
  },
});
