import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';

import { type ReplicaSyncResult } from '@/libs/replica';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import type { StoreSetter } from '@/store/types';
import { DocumentSourceType, type LobeDocument } from '@/types/document';
import { standardizeIdentifier } from '@/utils/identifier';
import { setNamespace } from '@/utils/storeDebug';

import { initialState, type PageState } from './initialState';
import { currentPageSize, PagePrivateAction } from './privateAction';
import { documentItemToLobeDocument, PAGE_LIST_KEY, TEMP_PAGE_ID_PREFIX } from './projection';
import { listSelectors } from './slices/list/selectors';
import { usePageStore } from './store';

const n = setNamespace('page');

export interface PageUpdateParams {
  emoji?: string;
  title?: string;
}

type Setter = StoreSetter<PageState>;

const withEmoji = (metadata: LobeDocument['metadata'], emoji: string | undefined) =>
  Object.fromEntries(
    Object.entries({ ...metadata, ...(emoji !== undefined ? { emoji } : {}) }).filter(
      ([, v]) => v !== undefined,
    ),
  );

export class PageActionImpl {
  readonly #get: () => PageState;
  readonly #private: PagePrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, get: () => PageState, privateAction: PagePrivateAction) {
    this.#set = set;
    this.#get = get;
    this.#private = privateAction;
  }

  useFetchDocuments = (): ReplicaSyncResult => {
    // Subscribed, so changing the page size re-keys the list query.
    const pageSize = useGlobalStore(systemStatusSelectors.pagePageSize);
    return this.#private.list.useSync({ pageSize });
  };

  useFetchPageDetail = (pageId?: string | null): ReplicaSyncResult =>
    this.#private.detail.useSync(pageId || null);

  preHydrate = (): Promise<boolean> => this.#private.preHydrateList();

  loadMoreDocuments = async (): Promise<void> => {
    await this.#private.list.loadMore(PAGE_LIST_KEY, { pageSize: currentPageSize() });
  };

  refreshDocuments = async (): Promise<void> => {
    await this.#private.revalidateList();
  };

  publishPageToWorkspace = async (pageId: string): Promise<{ documentIds: string[] }> => {
    const result = await documentService.publishDocumentToWorkspace(pageId);
    await this.refreshDocuments();
    return result;
  };

  setPageVisibility = async (
    pageId: string,
    visibility: 'private' | 'public',
  ): Promise<{ documentIds: string[] }> => {
    const result = await documentService.setDocumentVisibility(pageId, visibility);
    await this.refreshDocuments();
    return result;
  };

  upsertDocument = (document: DocumentItem): void => {
    const lobeDoc = documentItemToLobeDocument(document);
    this.#private.detail.update(lobeDoc.id, () => lobeDoc);
    if (this.#get().pageListMap[PAGE_LIST_KEY]?.items.some((doc) => doc.id === lobeDoc.id)) {
      this.#private.list.updateEntity(lobeDoc.id, () => lobeDoc);
    }
  };

  setSearchKeywords = (keywords: string): void => {
    this.#set({ searchKeywords: keywords }, false, n('setSearchKeywords'));
  };

  setShowOnlyPagesNotInLibrary = (show: boolean): void => {
    this.#set({ showOnlyPagesNotInLibrary: show }, false, n('setShowOnlyPagesNotInLibrary'));
  };

  closeAllPagesDrawer = (): void => {
    this.#set({ allPagesDrawerOpen: false }, false, n('closeAllPagesDrawer'));
  };

  openAllPagesDrawer = (): void => {
    this.#set({ allPagesDrawerOpen: true }, false, n('openAllPagesDrawer'));
  };

  selectPage = (pageId: string): void => {
    if (this.#get().selectedPageId === pageId) return;

    this.#set({ isCreatingNew: false, selectedPageId: pageId }, false, n('selectPage'));
    this.navigateToPage(pageId);
  };

  setRenamingPageId = (pageId: string | null): void => {
    this.#set({ renamingPageId: pageId }, false, n('setRenamingPageId'));
  };

  setSelectedPageId = (pageId: string | null, shouldNavigate: boolean = true): void => {
    this.#set({ selectedPageId: pageId }, false, n('setSelectedPageId'));
    if (shouldNavigate) this.navigateToPage(pageId);
  };

  navigateToPage = (pageId: string | null): void => {
    this.#get().navigate?.(pageId ? `/page/${standardizeIdentifier(pageId)}` : '/page');
  };

  createNewPage = async (title: string, visibility?: 'private' | 'public'): Promise<string> => {
    // The optimistic row lands in the requested bucket so it shows under the
    // accordion the user clicked "+" from before the server responds.
    const tempPageId = this.createOptimisticPage(title, visibility);
    this.#set({ isCreatingNew: true, selectedPageId: tempPageId }, false, n('createNewPage/start'));

    try {
      const realPage = documentItemToLobeDocument(
        await this.createPage({ content: '', title, visibility }),
      );

      this.#private.replaceListRow(tempPageId, realPage);
      this.#set(
        { isCreatingNew: false, selectedPageId: realPage.id },
        false,
        n('createNewPage/success'),
      );
      this.navigateToPage(realPage.id);

      return realPage.id;
    } catch (error) {
      console.error('Failed to create page:', error);
      this.removeTempPage(tempPageId);
      this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('createNewPage/error'));
      this.navigateToPage(null);

      throw error;
    }
  };

  createOptimisticPage = (
    title: string = 'Untitled',
    visibility?: 'private' | 'public',
  ): string => {
    const tempId = `${TEMP_PAGE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();

    this.#private.insertListRow({
      content: null,
      createdAt: now,
      editorData: null,
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      filename: title,
      id: tempId,
      metadata: {},
      source: 'document',
      sourceType: DocumentSourceType.EDITOR,
      title,
      totalCharCount: 0,
      totalLineCount: 0,
      updatedAt: now,
      visibility: visibility ?? null,
    });

    return tempId;
  };

  createPage = async ({
    title,
    content = '',
    knowledgeBaseId,
    parentId,
    visibility,
  }: {
    content?: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
    visibility?: 'private' | 'public';
  }): Promise<DocumentItem> =>
    documentService.createDocument({
      content,
      editorData: '{}',
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      knowledgeBaseId,
      metadata: { createdAt: Date.now() },
      parentId,
      title,
      visibility,
    });

  deletePage = async (pageId: string): Promise<void> => {
    if (this.#get().selectedPageId !== pageId) return;

    this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('deletePage'));
    this.navigateToPage(null);
  };

  duplicatePage = async (pageId: string): Promise<DocumentItem> => {
    const sourcePage = await documentService.getDocumentById(pageId);

    if (!sourcePage) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

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

    this.#private.insertListRow(documentItemToLobeDocument(newPage));

    return newPage;
  };

  removePage = async (pageId: string): Promise<void> => {
    const { selectedPageId } = this.#get();

    // Clear the selection before the row disappears so the editor navigates
    // away from the page it is about to lose.
    if (selectedPageId === pageId) {
      this.#set({ selectedPageId: null }, false, n('removePage/clearSelection'));
      this.navigateToPage(null);
    }

    try {
      await this.#private.entity.optimistic(pageId, 'remove', () =>
        documentService.deleteDocument(pageId),
      );
    } catch (error) {
      console.error('Failed to delete page:', error);
      if (selectedPageId === pageId) {
        this.#set({ selectedPageId: pageId }, false, n('removePage/restoreSelection'));
        this.navigateToPage(pageId);
      }
      throw error;
    }
  };

  removeTempPage = (tempId: string): void => {
    this.#private.entity.remove(tempId);
  };

  replaceTempPageWithReal = (tempId: string, realPage: LobeDocument): void => {
    this.#private.replaceListRow(tempId, realPage);
  };

  renamePage = async (pageId: string, title: string, emoji?: string): Promise<void> => {
    try {
      await this.updatePageOptimistically(pageId, { emoji, title });
    } catch (error) {
      console.error('Failed to rename page:', error);
    } finally {
      this.#set({ renamingPageId: null }, false, n('renamePage'));
    }
  };

  updatePageOptimistically = async (pageId: string, updates: PageUpdateParams): Promise<void> => {
    const existingPage = listSelectors.getDocumentById(pageId)(this.#get());

    if (!existingPage) {
      console.warn('[updatePageOptimistically] Page not found:', pageId);
      return;
    }

    const apply = (doc: LobeDocument): LobeDocument => ({
      ...doc,
      metadata: withEmoji(doc.metadata, updates.emoji),
      title: updates.title ?? doc.title,
      updatedAt: new Date(),
    });
    const updatedPage = apply(existingPage);

    try {
      await this.#private.entity.optimistic(pageId, apply, () =>
        documentService.updateDocument({
          id: pageId,
          metadata: updatedPage.metadata || {},
          parentId: updatedPage.parentId || undefined,
          title: updatedPage.title || updatedPage.filename,
        }),
      );

      // Land the server's ordering and derived fields.
      await this.#private.revalidateList();
    } catch (error) {
      console.error('[updatePageOptimistically] Failed to sync to DB:', error);
    }
  };

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = usePageStore;

export const pageActions = new PageActionImpl(
  setState,
  getState,
  new PagePrivateAction(setState, getState),
);
