import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { type PortalArtifact } from '@/types/artifact';

import { type PortalFile } from './initialState';

export interface ChatPortalAction {
  closeArtifact: () => void;
  closeDocument: () => void;
  closeFilePreview: () => void;
  closeMessageDetail: () => void;
  closeNotebook: () => void;
  closeToolUI: () => void;
  openArtifact: (artifact: PortalArtifact) => void;
  openDocument: (documentId: string) => void;
  openFilePreview: (portal: PortalFile) => void;
  openMessageDetail: (messageId: string) => void;
  openNotebook: () => void;
  openToolUI: (messageId: string, identifier: string) => void;
  toggleNotebook: (open?: boolean) => void;
  togglePortal: (open?: boolean) => void;
}

export const chatPortalSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatPortalAction
> = (set, get) => ({
  closeArtifact: () => {
    get().togglePortal(false);
    set({ portalArtifact: undefined }, false, 'closeArtifact');
  },
  closeDocument: () => {
    set({ portalDocumentId: undefined }, false, 'closeDocument');
  },
  closeFilePreview: () => {
    set({ portalFile: undefined }, false, 'closeFilePreview');
  },
  closeMessageDetail: () => {
    set({ portalMessageDetail: undefined }, false, 'openMessageDetail');
  },
  closeNotebook: () => {
    set({ showNotebook: false }, false, 'closeNotebook');
  },
  closeToolUI: () => {
    set({ portalToolMessage: undefined }, false, 'closeToolUI');
  },
  openArtifact: (artifact) => {
    get().togglePortal(true);

    set({ portalArtifact: artifact }, false, 'openArtifact');
  },
  openDocument: (documentId) => {
    get().togglePortal(true);

    set({ portalDocumentId: documentId, showNotebook: true }, false, 'openDocument');
  },
  openFilePreview: (portal) => {
    get().togglePortal(true);

    set({ portalFile: portal }, false, 'openFilePreview');
  },
  openMessageDetail: (messageId) => {
    get().togglePortal(true);

    set({ portalMessageDetail: messageId }, false, 'openMessageDetail');
  },

  openNotebook: () => {
    get().togglePortal(true);

    set({ showNotebook: true }, false, 'openNotebook');
  },

  openToolUI: (id, identifier) => {
    get().togglePortal(true);

    set({ portalToolMessage: { id, identifier } }, false, 'openToolUI');
  },

  toggleNotebook: (open) => {
    const showNotebook = open === undefined ? !get().showNotebook : open;

    get().togglePortal(showNotebook);
    set({ showNotebook }, false, 'toggleNotebook');
  },
  togglePortal: (open) => {
    const showInspector = open === undefined ? !get().showPortal : open;
    set({ showPortal: showInspector }, false, 'toggleInspector');
  },
  // updateArtifactContent: (content) => {
  //   set({ portalArtifact: content }, false, 'updateArtifactContent');
  // },
});
