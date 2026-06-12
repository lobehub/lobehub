import { localFileService } from '@/services/electron/localFileService';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type PortalArtifact } from '@/types/artifact';

import { createLocalFileTabId, getLocalFileTabId } from './helpers';
import { type OpenLocalFileParams, type PortalFile, type PortalViewData } from './initialState';
import { PortalViewType } from './initialState';

// Helper to get current view type from stack
const getCurrentViewType = (portalStack: PortalViewData[]): PortalViewType | null => {
  const top = portalStack.at(-1);
  return top?.type ?? null;
};

const findLocalFileIndexById = (
  openLocalFiles: Array<OpenLocalFileParams & { id?: string }>,
  id: string,
) => {
  const index = openLocalFiles.findIndex((file) => getLocalFileTabId(file) === id);
  return index >= 0 ? index : openLocalFiles.findIndex((file) => file.filePath === id);
};

const findLocalFileById = (
  openLocalFiles: Array<OpenLocalFileParams & { id?: string }>,
  id: string | undefined,
) =>
  id
    ? (openLocalFiles.find((file) => getLocalFileTabId(file) === id) ??
      openLocalFiles.find((file) => file.filePath === id))
    : undefined;

const resolveActiveLocalFile = (
  openLocalFiles: Array<OpenLocalFileParams & { id?: string }>,
  activeLocalFileId: string | undefined,
  activeLocalFilePath: string | undefined,
) =>
  findLocalFileById(openLocalFiles, activeLocalFileId) ??
  (activeLocalFilePath
    ? openLocalFiles.find((file) => file.filePath === activeLocalFilePath)
    : undefined);

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

  closeLocalFile = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.LocalFile) {
      this.#get().popPortalView();
    }
  };

  closeLocalFileTab = (id: string): void => {
    const { openLocalFiles, activeLocalFileId, activeLocalFilePath, dirtyLocalFileContents } =
      this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx === -1) return;

    const target = openLocalFiles[idx];
    const targetId = getLocalFileTabId(target);
    const nextFiles = openLocalFiles.filter((_, i) => i !== idx);

    let nextActiveId: string | undefined;
    let nextActivePath: string | undefined;
    const activeFile = resolveActiveLocalFile(
      openLocalFiles,
      activeLocalFileId,
      activeLocalFilePath,
    );
    if (activeFile && getLocalFileTabId(activeFile) === targetId) {
      const neighbor = nextFiles[idx] ?? nextFiles[idx - 1];
      nextActiveId = neighbor ? getLocalFileTabId(neighbor) : undefined;
      nextActivePath = neighbor?.filePath;
    } else {
      nextActiveId = activeLocalFileId;
      nextActivePath = activeLocalFilePath;
    }

    let nextDirty = dirtyLocalFileContents;
    const shouldClearDirty =
      !target.deviceId &&
      !nextFiles.some((file) => !file.deviceId && file.filePath === target.filePath);
    if (shouldClearDirty && target.filePath in dirtyLocalFileContents) {
      const { [target.filePath]: _, ...rest } = dirtyLocalFileContents;
      nextDirty = rest;
    }

    this.#set(
      {
        activeLocalFileId: nextActiveId,
        activeLocalFilePath: nextActivePath,
        dirtyLocalFileContents: nextDirty,
        openLocalFiles: nextFiles,
      },
      false,
      'closeLocalFileTab',
    );

    if (nextFiles.length === 0) {
      this.#get().closeLocalFile();
    }
  };

  closeLeftLocalFileTabs = (id: string): void => {
    const { openLocalFiles, activeLocalFileId, activeLocalFilePath } = this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx <= 0) return;

    const nextFiles = openLocalFiles.slice(idx);
    const activeFile = resolveActiveLocalFile(
      openLocalFiles,
      activeLocalFileId,
      activeLocalFilePath,
    );
    const currentActiveId = activeFile ? getLocalFileTabId(activeFile) : undefined;
    const targetId = getLocalFileTabId(openLocalFiles[idx]);
    const nextActiveId = nextFiles.some((f) => getLocalFileTabId(f) === currentActiveId)
      ? currentActiveId
      : targetId;
    const nextActiveFile = findLocalFileById(nextFiles, nextActiveId);

    this.#set(
      {
        activeLocalFileId: nextActiveId,
        activeLocalFilePath: nextActiveFile?.filePath,
        openLocalFiles: nextFiles,
      },
      false,
      'closeLeftLocalFileTabs',
    );
  };

  closeOtherLocalFileTabs = (id: string): void => {
    const { openLocalFiles } = this.#get();
    const target = findLocalFileById(openLocalFiles, id);
    if (!target) return;
    const targetId = getLocalFileTabId(target);
    const targetFile = { ...target, id: targetId };

    this.#set(
      {
        activeLocalFileId: targetId,
        activeLocalFilePath: target.filePath,
        openLocalFiles: [targetFile],
      },
      false,
      'closeOtherLocalFileTabs',
    );
  };

  closeRightLocalFileTabs = (id: string): void => {
    const { openLocalFiles, activeLocalFileId, activeLocalFilePath } = this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx < 0 || idx >= openLocalFiles.length - 1) return;

    const nextFiles = openLocalFiles.slice(0, idx + 1);
    const activeFile = resolveActiveLocalFile(
      openLocalFiles,
      activeLocalFileId,
      activeLocalFilePath,
    );
    const currentActiveId = activeFile ? getLocalFileTabId(activeFile) : undefined;
    const targetId = getLocalFileTabId(openLocalFiles[idx]);
    const nextActiveId = nextFiles.some((f) => getLocalFileTabId(f) === currentActiveId)
      ? currentActiveId
      : targetId;
    const nextActiveFile = findLocalFileById(nextFiles, nextActiveId);

    this.#set(
      {
        activeLocalFileId: nextActiveId,
        activeLocalFilePath: nextActiveFile?.filePath,
        openLocalFiles: nextFiles,
      },
      false,
      'closeRightLocalFileTabs',
    );
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

  openDocument = (documentId: string, agentDocumentId?: string): void => {
    this.#get().pushPortalView({ agentDocumentId, documentId, type: PortalViewType.Document });
  };

  openFilePreview = (file: PortalFile): void => {
    this.#get().pushPortalView({ file, type: PortalViewType.FilePreview });
  };

  openLocalFile = ({ deviceId, filePath, workingDirectory }: OpenLocalFileParams): void => {
    const { openLocalFiles } = this.#get();
    const id = createLocalFileTabId({ deviceId, filePath, workingDirectory });
    const exists = openLocalFiles.some((f) => getLocalFileTabId(f) === id);
    const nextFile = deviceId
      ? { deviceId, filePath, id, workingDirectory }
      : { filePath, id, workingDirectory };
    const nextFiles = exists
      ? openLocalFiles.map((file) => (getLocalFileTabId(file) === id ? nextFile : file))
      : [...openLocalFiles, nextFile];
    this.#set(
      { activeLocalFileId: id, activeLocalFilePath: filePath, openLocalFiles: nextFiles },
      false,
      'openLocalFile',
    );
    this.#get().pushPortalView({ type: PortalViewType.LocalFile });
  };

  setActiveLocalFile = (id: string): void => {
    const { openLocalFiles } = this.#get();
    const activeFile = findLocalFileById(openLocalFiles, id);
    this.#set(
      {
        activeLocalFileId: activeFile ? getLocalFileTabId(activeFile) : id,
        activeLocalFilePath: activeFile?.filePath ?? id,
      },
      false,
      'setActiveLocalFile',
    );
  };

  setLocalFileBuffer = (filePath: string, content: string | undefined): void => {
    const { dirtyLocalFileContents } = this.#get();
    if (content === undefined) {
      if (!(filePath in dirtyLocalFileContents)) return;

      const { [filePath]: _, ...rest } = dirtyLocalFileContents;
      this.#set({ dirtyLocalFileContents: rest }, false, 'setLocalFileBuffer/clear');
      return;
    }
    if (dirtyLocalFileContents[filePath] === content) return;
    this.#set(
      { dirtyLocalFileContents: { ...dirtyLocalFileContents, [filePath]: content } },
      false,
      'setLocalFileBuffer',
    );
  };

  saveLocalFile = async (filePath: string): Promise<string | undefined> => {
    const { dirtyLocalFileContents } = this.#get();
    const buffer = dirtyLocalFileContents[filePath];
    if (buffer === undefined) return undefined;
    await localFileService.writeFile({ content: buffer, path: filePath });
    return buffer;
  };

  openMessageDetail = (messageId: string): void => {
    this.#get().pushPortalView({ messageId, type: PortalViewType.MessageDetail });
  };

  openNotebook = (): void => {
    this.#get().pushPortalView({ type: PortalViewType.Notebook });
  };

  openToolUI = (messageId: string, identifier: string, params?: Record<string, any>): void => {
    this.#get().pushPortalView({ identifier, messageId, params, type: PortalViewType.ToolUI });
  };

  openVerifyResult = (operationId: string, checkItemId: string): void => {
    this.#get().pushPortalView({ checkItemId, operationId, type: PortalViewType.VerifyResult });
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
