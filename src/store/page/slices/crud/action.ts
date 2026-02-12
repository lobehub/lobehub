import { type SWRResponse } from 'swr';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { type StoreSetter } from '@/store/types';
import { type LobeDocument } from '@/types/document';
import { DocumentSourceType } from '@/types/document';
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

type Setter = StoreSetter<PageStore>;
export const createCrudSlice = (set: Setter, get: () => PageStore, _api?: unknown) =>
  new CrudActionImpl(set, get, _api);

export class CrudActionImpl {
  readonly #get: () => PageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => PageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewPage = async (title: string): Promise<string> => {
    const { createOptimisticPage, createPage, replaceTempPageWithReal } = this.#get();

    // Create optimistic page immediately
    const tempPageId = createOptimisticPage(title);
    this.#set({ isCreatingNew: true, selectedPageId: tempPageId }, false, n('createNewPage/start'));

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
      this.#set(
        { isCreatingNew: false, selectedPageId: newPage.id },
        false,
        n('createNewPage/success'),
      );

      // Navigate to the new page
      this.#get().navigateToPage(newPage.id);

      return newPage.id;
    } catch (error) {
      console.error('Failed to create page:', error);
      this.#get().removeTempPage(tempPageId);
      this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('createNewPage/error'));
      this.#get().navigate?.('/page');

      throw error;
    }
  };

  createOptimisticPage = (title: string = 'Untitled'): string => {
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
    this.#get().internal_dispatchDocuments({ document: newPage, type: 'addDocument' });

    return tempId;
  };

  createPage = async ({
    title,
    content = '',
    knowledgeBaseId,
    parentId,
  }: {
    content?: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
  }): Promise<{ [key: string]: any; id: string }> => {
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
  };

  deletePage = async (pageId: string): Promise<void> => {
    const { selectedPageId } = this.#get();

    if (selectedPageId === pageId) {
      this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('deletePage'));
      this.#get().navigateToPage(null);
    }
  };

  duplicatePage = async (pageId: string): Promise<{ [key: string]: any; id: string }> => {
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

    this.#get().internal_dispatchDocuments({ document: editorPage, type: 'addDocument' });

    return newPage;
  };

  navigateToPage = (pageId: string | null): void => {
    if (!pageId) {
      this.#get().navigate?.('/page');
    } else {
      this.#get().navigate?.(`/page/${standardizeIdentifier(pageId)}`);
    }
  };

  removePage = async (pageId: string): Promise<void> => {
    const { documents, selectedPageId } = this.#get();

    // Store original documents for rollback
    const originalDocuments = documents;

    // Remove from documents array via internal dispatch (optimistic update)
    this.#get().internal_dispatchDocuments({ id: pageId, type: 'removeDocument' });

    // Clear selected page ID if the deleted page is currently selected
    if (selectedPageId === pageId) {
      this.#set({ selectedPageId: null }, false, n('removePage/clearSelection'));
      this.#get().navigateToPage(null);
    }

    try {
      // Delete from documents table
      await documentService.deleteDocument(pageId);
    } catch (error) {
      console.error('Failed to delete page:', error);
      // Restore documents on error
      if (originalDocuments) {
        this.#get().internal_dispatchDocuments({
          documents: originalDocuments,
          type: 'setDocuments',
        });
      }
      if (selectedPageId === pageId) {
        this.#set({ selectedPageId: pageId }, false, n('removePage/restoreSelection'));
        this.#get().navigateToPage(pageId);
      }
      throw error;
    }
  };

  removeTempPage = (tempId: string): void => {
    this.#get().internal_dispatchDocuments({ id: tempId, type: 'removeDocument' });
  };

  renamePage = async (pageId: string, title: string, emoji?: string): Promise<void> => {
    const { updatePageOptimistically } = this.#get();

    try {
      await updatePageOptimistically(pageId, { emoji, title });
    } catch (error) {
      console.error('Failed to rename page:', error);
    } finally {
      this.#set({ renamingPageId: null }, false, n('renamePage'));
    }
  };

  replaceTempPageWithReal = (tempId: string, realPage: LobeDocument): void => {
    this.#get().internal_dispatchDocuments({
      document: realPage,
      oldId: tempId,
      type: 'replaceDocument',
    });
  };

  updatePage = async (id: string, updates: Partial<LobeDocument>): Promise<void> => {
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
    await this.#get().refreshDocuments();
  };

  updatePageOptimistically = async (pageId: string, updates: PageUpdateParams): Promise<void> => {
    const { documents } = this.#get();

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
    this.#get().internal_dispatchDocuments({
      document: updatedPage,
      id: pageId,
      type: 'updateDocument',
    });

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
      await this.#get().refreshDocuments();
    } catch (error) {
      console.error('[updatePageOptimistically] Failed to sync to DB:', error);
      // On error, revert by restoring original page
      this.#get().internal_dispatchDocuments({
        document: existingPage,
        id: pageId,
        type: 'updateDocument',
      });
    }
  };

  useFetchPageDetail = (pageId: string | undefined): SWRResponse<LobeDocument | null> => {
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
          const { documents } = this.#get();
          if (documents?.some((doc) => doc.id === pageId)) {
            this.#get().internal_dispatchDocuments({
              document,
              id: pageId,
              type: 'updateDocument',
            });
          }
        },
        revalidateOnFocus: true,
      },
    );
  };
}

export type CrudAction = Pick<CrudActionImpl, keyof CrudActionImpl>;
