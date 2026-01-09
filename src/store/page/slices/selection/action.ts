import { type StateCreator } from 'zustand/vanilla';

import { useGlobalStore } from '@/store/global';
import { standardizeIdentifier } from '@/utils/identifier';
import { setNamespace } from '@/utils/storeDebug';

import { type PageStore } from '../../store';

const n = setNamespace('page/selection');

const navigateToPage = (pageId: string | null) => {
  const dryPageId = standardizeIdentifier(pageId ?? '') ?? '';
  console.log(useGlobalStore.getState().navigate);
  useGlobalStore.getState().navigate?.(`/page/${dryPageId}`);
};

export interface SelectionAction {
  /**
   * Close all pages drawer
   */
  closeAllPagesDrawer: () => void;
  /**
   * Open all pages drawer
   */
  openAllPagesDrawer: () => void;
  /**
   * Select a page (updates URL and state)
   */
  selectPage: (pageId: string) => void;
  /**
   * Set the ID of the page being renamed
   */
  setRenamingPageId: (pageId: string | null) => void;
  /**
   * Set selected page ID
   */
  setSelectedPageId: (pageId: string | null, shouldNavigate?: boolean) => void;
}

export const createSelectionSlice: StateCreator<
  PageStore,
  [['zustand/devtools', never]],
  [],
  SelectionAction
> = (set, get) => ({
  closeAllPagesDrawer: () => {
    set({ allPagesDrawerOpen: false }, false, n('closeAllPagesDrawer'));
  },

  openAllPagesDrawer: () => {
    set({ allPagesDrawerOpen: true }, false, n('openAllPagesDrawer'));
  },

  selectPage: (pageId: string) => {
    const { selectedPageId } = get();

    // Don't allow deselecting the current page
    if (selectedPageId === pageId) return;

    // Select and navigate
    set({ isCreatingNew: false, selectedPageId: pageId }, false, n('selectPage'));
  },

  setRenamingPageId: (pageId: string | null) => {
    set({ renamingPageId: pageId }, false, n('setRenamingPageId'));
  },

  setSelectedPageId: (pageId: string | null, shouldNavigate = true) => {
    set({ selectedPageId: pageId }, false, n('setSelectedPageId'));
    if (shouldNavigate) {
      navigateToPage(pageId);
    }
  },
});
