import { localFileService } from '@/services/electron/localFileService';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type PortalArtifact } from '@/types/artifact';

import { createLocalFileScopeKey, createLocalFileTabId, getLocalFileTabId } from './helpers';
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

const findLocalFileById = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  id: string | undefined,
) =>
  id
    ? (openLocalFiles.find((file) => getLocalFileTabId(file) === id) ??
      openLocalFiles.find((file) => file.filePath === id))
    : undefined;

const getLocalFileEntryScopeKey = (file: OpenLocalFileParams): string =>
  createLocalFileScopeKey(file.workingDirectory);

const getLocalFilesInScope = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  scopeKey: string,
) => openLocalFiles.filter((file) => getLocalFileEntryScopeKey(file) === scopeKey);

const resolveActiveLocalFile = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  activeLocalFileId: string | undefined,
  activeLocalFilePath: string | undefined,
) =>
  findLocalFileById(openLocalFiles, activeLocalFileId) ??
  (activeLocalFilePath
    ? openLocalFiles.find((file) => file.filePath === activeLocalFilePath)
    : undefined);

const resolveActiveLocalFileInScope = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  scopeKey: string,
  activeLocalFileIdsByScope: Record<string, string> | undefined,
  activeLocalFileId: string | undefined,
  activeLocalFilePath: string | undefined,
) =>
  findLocalFileById(openLocalFiles, activeLocalFileIdsByScope?.[scopeKey]) ??
  resolveActiveLocalFile(openLocalFiles, activeLocalFileId, activeLocalFilePath);

const setActiveLocalFileForScope = (
  activeLocalFileIdsByScope: Record<string, string> | undefined,
  scopeKey: string,
  activeFile: (OpenLocalFileParams & { id?: string }) | undefined,
) => {
  const next = { ...activeLocalFileIdsByScope };

  if (activeFile) {
    next[scopeKey] = getLocalFileTabId(activeFile);
  } else {
    delete next[scopeKey];
  }

  return next;
};

const keepScopedLocalFiles = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  scopeKey: string,
  scopedFilesToKeep: T[],
) => {
  const keepIds = new Set(scopedFilesToKeep.map(getLocalFileTabId));

  return openLocalFiles.filter(
    (file) => getLocalFileEntryScopeKey(file) !== scopeKey || keepIds.has(getLocalFileTabId(file)),
  );
};

const resolveLegacyActiveAfterClose = ({
  activeLocalFileId,
  activeLocalFilePath,
  nextScopeActiveFile,
  nextOpenLocalFiles,
  openLocalFiles,
}: {
  activeLocalFileId: string | undefined;
  activeLocalFilePath: string | undefined;
  nextScopeActiveFile: (OpenLocalFileParams & { id?: string }) | undefined;
  nextOpenLocalFiles: Array<OpenLocalFileParams & { id?: string }>;
  openLocalFiles: Array<OpenLocalFileParams & { id?: string }>;
}) => {
  const activeFile = resolveActiveLocalFile(openLocalFiles, activeLocalFileId, activeLocalFilePath);
  const activeStillOpen =
    activeFile &&
    nextOpenLocalFiles.some((file) => getLocalFileTabId(file) === getLocalFileTabId(activeFile));

  if (!activeFile || activeStillOpen) {
    return { activeLocalFileId, activeLocalFilePath };
  }

  return {
    activeLocalFileId: nextScopeActiveFile ? getLocalFileTabId(nextScopeActiveFile) : undefined,
    activeLocalFilePath: nextScopeActiveFile?.filePath,
  };
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

  closeLocalFile = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.LocalFile) {
      this.#get().popPortalView();
    }
  };

  closeLocalFileTab = (id: string): void => {
    const {
      activeLocalFileId,
      activeLocalFileIdsByScope,
      activeLocalFilePath,
      dirtyLocalFileContents,
      openLocalFiles,
    } = this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx === -1) return;

    const target = openLocalFiles[idx];
    const targetId = getLocalFileTabId(target);
    const scopeKey = getLocalFileEntryScopeKey(target);
    const scopedFiles = getLocalFilesInScope(openLocalFiles, scopeKey);
    const scopedIdx = findLocalFileIndexById(scopedFiles, targetId);
    const nextFiles = openLocalFiles.filter((_, i) => i !== idx);
    const nextScopedFiles = scopedFiles.filter((_, i) => i !== scopedIdx);

    const scopedActiveFile = resolveActiveLocalFileInScope(
      scopedFiles,
      scopeKey,
      activeLocalFileIdsByScope,
      activeLocalFileId,
      activeLocalFilePath,
    );
    const nextScopeActiveFile =
      scopedActiveFile && getLocalFileTabId(scopedActiveFile) === targetId
        ? (nextScopedFiles[scopedIdx] ?? nextScopedFiles[scopedIdx - 1])
        : scopedActiveFile;
    const legacyActive = resolveLegacyActiveAfterClose({
      activeLocalFileId,
      activeLocalFilePath,
      nextOpenLocalFiles: nextFiles,
      nextScopeActiveFile,
      openLocalFiles,
    });

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
        activeLocalFileId: legacyActive.activeLocalFileId,
        activeLocalFileIdsByScope: setActiveLocalFileForScope(
          activeLocalFileIdsByScope,
          scopeKey,
          nextScopeActiveFile,
        ),
        activeLocalFilePath: legacyActive.activeLocalFilePath,
        dirtyLocalFileContents: nextDirty,
        openLocalFiles: nextFiles,
      },
      false,
      'closeLocalFileTab',
    );

    if (nextScopedFiles.length === 0) {
      this.#get().closeLocalFile();
    }
  };

  closeLeftLocalFileTabs = (id: string): void => {
    const { activeLocalFileId, activeLocalFileIdsByScope, activeLocalFilePath, openLocalFiles } =
      this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx < 0) return;

    const target = openLocalFiles[idx];
    const scopeKey = getLocalFileEntryScopeKey(target);
    const scopedFiles = getLocalFilesInScope(openLocalFiles, scopeKey);
    const scopedIdx = findLocalFileIndexById(scopedFiles, getLocalFileTabId(target));
    if (scopedIdx <= 0) return;

    const nextScopedFiles = scopedFiles.slice(scopedIdx);
    const nextFiles = keepScopedLocalFiles(openLocalFiles, scopeKey, nextScopedFiles);
    const scopedActiveFile = resolveActiveLocalFileInScope(
      scopedFiles,
      scopeKey,
      activeLocalFileIdsByScope,
      activeLocalFileId,
      activeLocalFilePath,
    );
    const currentScopeActiveId = scopedActiveFile ? getLocalFileTabId(scopedActiveFile) : undefined;
    const targetId = getLocalFileTabId(target);
    const nextScopeActiveId = nextScopedFiles.some(
      (f) => getLocalFileTabId(f) === currentScopeActiveId,
    )
      ? currentScopeActiveId
      : targetId;
    const nextScopeActiveFile = findLocalFileById(nextScopedFiles, nextScopeActiveId);
    const legacyActive = resolveLegacyActiveAfterClose({
      activeLocalFileId,
      activeLocalFilePath,
      nextOpenLocalFiles: nextFiles,
      nextScopeActiveFile,
      openLocalFiles,
    });

    this.#set(
      {
        activeLocalFileId: legacyActive.activeLocalFileId,
        activeLocalFileIdsByScope: setActiveLocalFileForScope(
          activeLocalFileIdsByScope,
          scopeKey,
          nextScopeActiveFile,
        ),
        activeLocalFilePath: legacyActive.activeLocalFilePath,
        openLocalFiles: nextFiles,
      },
      false,
      'closeLeftLocalFileTabs',
    );
  };

  closeOtherLocalFileTabs = (id: string): void => {
    const { activeLocalFileIdsByScope, openLocalFiles } = this.#get();
    const target = findLocalFileById(openLocalFiles, id);
    if (!target) return;
    const scopeKey = getLocalFileEntryScopeKey(target);
    const targetId = getLocalFileTabId(target);
    const targetFile = { ...target, id: targetId };
    const nextFiles = keepScopedLocalFiles(openLocalFiles, scopeKey, [targetFile]);

    this.#set(
      {
        activeLocalFileId: targetId,
        activeLocalFileIdsByScope: setActiveLocalFileForScope(
          activeLocalFileIdsByScope,
          scopeKey,
          targetFile,
        ),
        activeLocalFilePath: target.filePath,
        openLocalFiles: nextFiles,
      },
      false,
      'closeOtherLocalFileTabs',
    );
  };

  closeRightLocalFileTabs = (id: string): void => {
    const { activeLocalFileId, activeLocalFileIdsByScope, activeLocalFilePath, openLocalFiles } =
      this.#get();
    const idx = findLocalFileIndexById(openLocalFiles, id);
    if (idx < 0) return;

    const target = openLocalFiles[idx];
    const scopeKey = getLocalFileEntryScopeKey(target);
    const scopedFiles = getLocalFilesInScope(openLocalFiles, scopeKey);
    const scopedIdx = findLocalFileIndexById(scopedFiles, getLocalFileTabId(target));
    if (scopedIdx < 0 || scopedIdx >= scopedFiles.length - 1) return;

    const nextScopedFiles = scopedFiles.slice(0, scopedIdx + 1);
    const nextFiles = keepScopedLocalFiles(openLocalFiles, scopeKey, nextScopedFiles);
    const scopedActiveFile = resolveActiveLocalFileInScope(
      scopedFiles,
      scopeKey,
      activeLocalFileIdsByScope,
      activeLocalFileId,
      activeLocalFilePath,
    );
    const currentScopeActiveId = scopedActiveFile ? getLocalFileTabId(scopedActiveFile) : undefined;
    const targetId = getLocalFileTabId(target);
    const nextScopeActiveId = nextScopedFiles.some(
      (f) => getLocalFileTabId(f) === currentScopeActiveId,
    )
      ? currentScopeActiveId
      : targetId;
    const nextScopeActiveFile = findLocalFileById(nextScopedFiles, nextScopeActiveId);
    const legacyActive = resolveLegacyActiveAfterClose({
      activeLocalFileId,
      activeLocalFilePath,
      nextOpenLocalFiles: nextFiles,
      nextScopeActiveFile,
      openLocalFiles,
    });

    this.#set(
      {
        activeLocalFileId: legacyActive.activeLocalFileId,
        activeLocalFileIdsByScope: setActiveLocalFileForScope(
          activeLocalFileIdsByScope,
          scopeKey,
          nextScopeActiveFile,
        ),
        activeLocalFilePath: legacyActive.activeLocalFilePath,
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
    const { activeLocalFileIdsByScope, openLocalFiles } = this.#get();
    const id = createLocalFileTabId({ deviceId, filePath, workingDirectory });
    const scopeKey = createLocalFileScopeKey(workingDirectory);
    const exists = openLocalFiles.some((f) => getLocalFileTabId(f) === id);
    const nextFile = deviceId
      ? { deviceId, filePath, id, workingDirectory }
      : { filePath, id, workingDirectory };
    const nextFiles = exists
      ? openLocalFiles.map((file) => (getLocalFileTabId(file) === id ? nextFile : file))
      : [...openLocalFiles, nextFile];
    this.#set(
      {
        activeLocalFileId: id,
        activeLocalFileIdsByScope: setActiveLocalFileForScope(
          activeLocalFileIdsByScope,
          scopeKey,
          nextFile,
        ),
        activeLocalFilePath: filePath,
        openLocalFiles: nextFiles,
      },
      false,
      'openLocalFile',
    );
    this.#get().pushPortalView({ type: PortalViewType.LocalFile });
  };

  setActiveLocalFile = (id: string): void => {
    const { activeLocalFileIdsByScope, openLocalFiles } = this.#get();
    const activeFile = findLocalFileById(openLocalFiles, id);
    const scopeKey = activeFile ? getLocalFileEntryScopeKey(activeFile) : undefined;
    this.#set(
      {
        activeLocalFileId: activeFile ? getLocalFileTabId(activeFile) : id,
        activeLocalFileIdsByScope: scopeKey
          ? setActiveLocalFileForScope(activeLocalFileIdsByScope, scopeKey, activeFile)
          : activeLocalFileIdsByScope,
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
