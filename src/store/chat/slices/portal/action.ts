import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type PortalArtifact } from '@/types/artifact';

import { type PortalFile, type PortalViewData } from './initialState';
import { PortalViewType } from './initialState';

// Helper to get current view type from stack
const getCurrentViewType = (portalStack: PortalViewData[]): PortalViewType | null => {
  const top = portalStack.at(-1);
  return top?.type ?? null;
};

type Setter = StoreSetter<ChatStore>;
export const chatPortalSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatPortalActionImpl(set, get, _api);

export class ChatPortalActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  clearPortalStack = (): void => {
    this.#set({ portalStack: [], showPortal: false }, false, 'clearPortalStack');
  };

  closeArtifact = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.Artifact) {
      this.#get().popPortalView();
    }
  };

  closeDocument = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.Document) {
      this.#get().popPortalView();
    }
  };

  closeFilePreview = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.FilePreview) {
      this.#get().popPortalView();
    }
  };

  closeMessageDetail = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.MessageDetail) {
      this.#get().popPortalView();
    }
  };

  closeNotebook = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.Notebook) {
      this.#get().popPortalView();
    }
  };

  closeToolUI = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.ToolUI) {
      this.#get().popPortalView();
    }
  };

  goBack = (): void => {
    this.#get().popPortalView();
  };

  goHome = (): void => {
    this.#set(
      {
        portalStack: [{ type: PortalViewType.Home }],
        showPortal: true,
      },
      false,
      'goHome',
    );
  };

  openArtifact = (artifact: PortalArtifact): void => {
    this.#get().pushPortalView({ artifact, type: PortalViewType.Artifact });
  };

  openDocument = (documentId: string): void => {
    this.#get().pushPortalView({ documentId, type: PortalViewType.Document });
  };

  openFilePreview = (file: PortalFile): void => {
    this.#get().pushPortalView({ file, type: PortalViewType.FilePreview });
  };

  openMessageDetail = (messageId: string): void => {
    this.#get().pushPortalView({ messageId, type: PortalViewType.MessageDetail });
  };

  openNotebook = (): void => {
    this.#get().pushPortalView({ type: PortalViewType.Notebook });
  };

  openToolUI = (messageId: string, identifier: string): void => {
    this.#get().pushPortalView({ identifier, messageId, type: PortalViewType.ToolUI });
  };

  popPortalView = (): void => {
    const { portalStack } = this.#get();

    if (portalStack.length <= 1) {
      // Stack empty or only one item, clear stack and close portal
      this.#set({ portalStack: [], showPortal: false }, false, 'popPortalView/close');
    } else {
      this.#set({ portalStack: portalStack.slice(0, -1) }, false, 'popPortalView');
    }
  };

  pushPortalView = (view: PortalViewData): void => {
    const { portalStack } = this.#get();
    const top = portalStack.at(-1);

    // If top of stack is same type, replace instead of push (avoid duplicates)
    if (top?.type === view.type) {
      this.#set(
        {
          portalStack: [...portalStack.slice(0, -1), view],
          showPortal: true,
        },
        false,
        'pushPortalView/replace',
      );
    } else {
      this.#set(
        {
          portalStack: [...portalStack, view],
          showPortal: true,
        },
        false,
        'pushPortalView',
      );
    }
  };

  replacePortalView = (view: PortalViewData): void => {
    const { portalStack } = this.#get();

    if (portalStack.length === 0) {
      this.#set({ portalStack: [view], showPortal: true }, false, 'replacePortalView/push');
    } else {
      this.#set(
        {
          portalStack: [...portalStack.slice(0, -1), view],
          showPortal: true,
        },
        false,
        'replacePortalView',
      );
    }
  };

  toggleNotebook = (open?: boolean): void => {
    const { portalStack } = this.#get();
    const isCurrentlyNotebook = getCurrentViewType(portalStack) === PortalViewType.Notebook;
    const shouldOpen = open ?? !isCurrentlyNotebook;

    if (shouldOpen) {
      this.#get().openNotebook();
    } else {
      this.#get().closeNotebook();
    }
  };
}

export type ChatPortalAction = Pick<ChatPortalActionImpl, keyof ChatPortalActionImpl>;
