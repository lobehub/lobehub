import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { type PortalArtifact } from '@/types/artifact';

import { type PortalFile, type PortalViewData, PortalViewType } from './initialState';

export interface ChatPortalAction {
  // ============== Core Stack Operations ==============
  clearPortalStack: () => void;
  // ============== Convenience Methods ==============
  closeArtifact: () => void;
  closeDocument: () => void;
  closeFilePreview: () => void;
  closeMessageDetail: () => void;
  closeNotebook: () => void;

  closeToolUI: () => void;
  goBack: () => void;
  goHome: () => void;
  openArtifact: (artifact: PortalArtifact) => void;
  openDocument: (documentId: string) => void;
  openFilePreview: (file: PortalFile) => void;
  openMessageDetail: (messageId: string) => void;
  openNotebook: () => void;
  openToolUI: (messageId: string, identifier: string) => void;
  popPortalView: () => void;
  pushPortalView: (view: PortalViewData) => void;
  replacePortalView: (view: PortalViewData) => void;
  toggleNotebook: (open?: boolean) => void;
  togglePortal: (open?: boolean) => void;
}

// Helper to get current view type from stack
const getCurrentViewType = (portalStack: PortalViewData[]): PortalViewType | null => {
  const top = portalStack.at(-1);
  return top?.type ?? null;
};

export const chatPortalSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPortalAction
> = (set, get) => ({


  clearPortalStack: () => {
    set({ portalStack: [], showPortal: false }, false, 'clearPortalStack');
  },


closeArtifact: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.Artifact) {
      get().popPortalView();
    }
  },


closeDocument: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.Document) {
      get().popPortalView();
    }
  },


closeFilePreview: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.FilePreview) {
      get().popPortalView();
    }
  },


closeMessageDetail: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.MessageDetail) {
      get().popPortalView();
    }
  },


closeNotebook: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.Notebook) {
      get().popPortalView();
    }
  },




closeToolUI: () => {
    const { portalStack } = get();
    if (getCurrentViewType(portalStack) === PortalViewType.ToolUI) {
      get().popPortalView();
    }
  },



goBack: () => {
    get().popPortalView();
  },



goHome: () => {
    set(
      {
        portalStack: [{ type: PortalViewType.Home }],
        showPortal: true,
      },
      false,
      'goHome',
    );
  },



// ============== Convenience Methods (using stack operations) ==============
openArtifact: (artifact) => {
    get().pushPortalView({ artifact, type: PortalViewType.Artifact });
  },




openDocument: (documentId) => {
    get().pushPortalView({ documentId, type: PortalViewType.Document });
  },




openFilePreview: (file) => {
    get().pushPortalView({ file, type: PortalViewType.FilePreview });
  },



openMessageDetail: (messageId) => {
    get().pushPortalView({ messageId, type: PortalViewType.MessageDetail });
  },


openNotebook: () => {
    get().pushPortalView({ type: PortalViewType.Notebook });
  },


openToolUI: (messageId, identifier) => {
    get().pushPortalView({ identifier, messageId, type: PortalViewType.ToolUI });
  },


popPortalView: () => {
    const { portalStack } = get();

    if (portalStack.length <= 1) {
      // Stack empty or only one item, clear stack and close portal
      set({ portalStack: [], showPortal: false }, false, 'popPortalView/close');
    } else {
      set({ portalStack: portalStack.slice(0, -1) }, false, 'popPortalView');
    }
  },

  // ============== Core Stack Operations ==============
pushPortalView: (view) => {
    const { portalStack } = get();
    const top = portalStack.at(-1);

    // If top of stack is same type, replace instead of push (avoid duplicates)
    if (top?.type === view.type) {
      set(
        {
          portalStack: [...portalStack.slice(0, -1), view],
          showPortal: true,
        },
        false,
        'pushPortalView/replace',
      );
    } else {
      set(
        {
          portalStack: [...portalStack, view],
          showPortal: true,
        },
        false,
        'pushPortalView',
      );
    }
  },

  replacePortalView: (view) => {
    const { portalStack } = get();

    if (portalStack.length === 0) {
      set({ portalStack: [view], showPortal: true }, false, 'replacePortalView/push');
    } else {
      set(
        {
          portalStack: [...portalStack.slice(0, -1), view],
          showPortal: true,
        },
        false,
        'replacePortalView',
      );
    }
  },

  toggleNotebook: (open) => {
    const { portalStack } = get();
    const isCurrentlyNotebook = getCurrentViewType(portalStack) === PortalViewType.Notebook;
    const shouldOpen = open ?? !isCurrentlyNotebook;

    if (shouldOpen) {
      get().openNotebook();
    } else {
      get().closeNotebook();
    }
  },

  togglePortal: (open) => {
    const nextOpen = open === undefined ? !get().showPortal : open;

    if (!nextOpen) {
      // When closing, clear the stack
      set({ portalStack: [], showPortal: false }, false, 'togglePortal/close');
    } else {
      // When opening, if stack is empty, push Home view
      const { portalStack } = get();
      if (portalStack.length === 0) {
        set(
          {
            portalStack: [{ type: PortalViewType.Home }],
            showPortal: true,
          },
          false,
          'togglePortal/openHome',
        );
      } else {
        set({ showPortal: true }, false, 'togglePortal/open');
      }
    }
  },
});
