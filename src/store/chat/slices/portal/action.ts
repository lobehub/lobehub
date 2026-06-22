import { projectFileService } from '@/services/projectFile';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { type PortalArtifact } from '@/types/artifact';

import { topicSelectors } from '../topic/selectors';
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

const getLocalFilesInEntryScope = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  scopeKey: string,
) => openLocalFiles.filter((file) => getLocalFileEntryScopeKey(file) === scopeKey);

const getCurrentLocalFileScopeKey = (state: ChatStore): string | undefined => {
  const workingDirectory = topicSelectors.currentTopicWorkingDirectory(state);

  return workingDirectory ? createLocalFileScopeKey(workingDirectory) : undefined;
};

const getLocalFileCloseScope = <T extends OpenLocalFileParams & { id?: string }>({
  openLocalFiles,
  state,
  target,
}: {
  openLocalFiles: T[];
  state: ChatStore;
  target: T;
}): { files: T[]; scopeKey: string } => {
  const currentScopeKey = getCurrentLocalFileScopeKey(state);
  const targetEntryScopeKey = getLocalFileEntryScopeKey(target);
  const targetIsVisibleInCurrentScope =
    !!currentScopeKey &&
    (target.allowExternalFilePreview || targetEntryScopeKey === currentScopeKey);

  if (!currentScopeKey || !targetIsVisibleInCurrentScope) {
    return {
      files: getLocalFilesInEntryScope(openLocalFiles, targetEntryScopeKey),
      scopeKey: targetEntryScopeKey,
    };
  }

  return {
    files: openLocalFiles.filter(
      (file) =>
        file.allowExternalFilePreview || getLocalFileEntryScopeKey(file) === currentScopeKey,
    ),
    scopeKey: currentScopeKey,
  };
};

const getLocalFileActivationScopeKey = (state: ChatStore, file: OpenLocalFileParams): string => {
  const entryScopeKey = getLocalFileEntryScopeKey(file);
  const currentScopeKey = getCurrentLocalFileScopeKey(state);

  return file.allowExternalFilePreview && currentScopeKey ? currentScopeKey : entryScopeKey;
};

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

const keepCloseScopedLocalFiles = <T extends OpenLocalFileParams & { id?: string }>(
  openLocalFiles: T[],
  closeScopeFiles: T[],
  closeScopeFilesToKeep: T[],
) => {
  const closeScopeIds = new Set(closeScopeFiles.map(getLocalFileTabId));
  const keepIds = new Set(closeScopeFilesToKeep.map(getLocalFileTabId));

  return openLocalFiles.filter((file) => {
    const id = getLocalFileTabId(file);
    return !closeScopeIds.has(id) || keepIds.has(id);
  });
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
    const { files: scopedFiles, scopeKey } = getLocalFileCloseScope({
      openLocalFiles,
      state: this.#get(),
      target,
    });
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

    // Edit buffers are keyed by tab identity, so each tab owns its buffer — drop
    // this tab's unsaved content (the close was confirmed) without touching the
    // buffer of any other tab that happens to share the same absolute path.
    let nextDirty = dirtyLocalFileContents;
    if (targetId in dirtyLocalFileContents) {
      const { [targetId]: _, ...rest } = dirtyLocalFileContents;
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
    const { files: scopedFiles, scopeKey } = getLocalFileCloseScope({
      openLocalFiles,
      state: this.#get(),
      target,
    });
    const scopedIdx = findLocalFileIndexById(scopedFiles, getLocalFileTabId(target));
    if (scopedIdx <= 0) return;

    const nextScopedFiles = scopedFiles.slice(scopedIdx);
    const nextFiles = keepCloseScopedLocalFiles(openLocalFiles, scopedFiles, nextScopedFiles);
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
    const { files: scopedFiles, scopeKey } = getLocalFileCloseScope({
      openLocalFiles,
      state: this.#get(),
      target,
    });
    const targetId = getLocalFileTabId(target);
    const targetFile = { ...target, id: targetId };
    const nextFiles = keepCloseScopedLocalFiles(openLocalFiles, scopedFiles, [targetFile]);

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
    const { files: scopedFiles, scopeKey } = getLocalFileCloseScope({
      openLocalFiles,
      state: this.#get(),
      target,
    });
    const scopedIdx = findLocalFileIndexById(scopedFiles, getLocalFileTabId(target));
    if (scopedIdx < 0 || scopedIdx >= scopedFiles.length - 1) return;

    const nextScopedFiles = scopedFiles.slice(0, scopedIdx + 1);
    const nextFiles = keepCloseScopedLocalFiles(openLocalFiles, scopedFiles, nextScopedFiles);
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

  closeTaskDetail = (): void => {
    const { portalStack } = this.#get();
    if (getCurrentViewType(portalStack) === PortalViewType.TaskDetail) {
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

  openLocalFile = ({
    allowExternalFilePreview,
    deviceId,
    filePath,
    workingDirectory,
  }: OpenLocalFileParams): void => {
    const { activeLocalFileIdsByScope, openLocalFiles } = this.#get();
    const id = createLocalFileTabId({ deviceId, filePath, workingDirectory });
    const exists = openLocalFiles.some((f) => getLocalFileTabId(f) === id);
    const nextFile = {
      ...(allowExternalFilePreview === undefined ? {} : { allowExternalFilePreview }),
      ...(deviceId ? { deviceId } : {}),
      filePath,
      id,
      workingDirectory,
    };
    const scopeKey = getLocalFileActivationScopeKey(this.#get(), nextFile);
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
    const scopeKey = activeFile
      ? getLocalFileActivationScopeKey(this.#get(), activeFile)
      : undefined;
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

  setLocalFileBuffer = (tabId: string, content: string | undefined): void => {
    const { dirtyLocalFileContents } = this.#get();
    if (content === undefined) {
      if (!(tabId in dirtyLocalFileContents)) return;

      const { [tabId]: _, ...rest } = dirtyLocalFileContents;
      this.#set({ dirtyLocalFileContents: rest }, false, 'setLocalFileBuffer/clear');
      return;
    }
    if (dirtyLocalFileContents[tabId] === content) return;
    this.#set(
      { dirtyLocalFileContents: { ...dirtyLocalFileContents, [tabId]: content } },
      false,
      'setLocalFileBuffer',
    );
  };

  saveLocalFile = async ({
    deviceId,
    filePath,
    workingDirectory,
  }: OpenLocalFileParams): Promise<string | undefined> => {
    const { dirtyLocalFileContents } = this.#get();
    // Edit buffers are scoped by tab identity (device + working directory +
    // path), so the same absolute path opened on two devices/workspaces keeps
    // independent unsaved content.
    const tabId = createLocalFileTabId({ deviceId, filePath, workingDirectory });
    const buffer = dirtyLocalFileContents[tabId];
    if (buffer === undefined) return undefined;
    // deviceId routes the write to the remote device over RPC; local desktop
    // (no deviceId) goes straight to Electron IPC. The chokepoint hides the split.
    const result = await projectFileService.writeProjectFile({
      content: buffer,
      deviceId,
      path: filePath,
      workingDirectory,
    });
    // The remote RPC / local IPC report fs failures (permission denied, etc.) as
    // `{ success: false }` rather than rejecting — treat that as a failed save so
    // the caller keeps the buffer dirty instead of marking it clean.
    if (!result.success) throw new Error(result.error || 'Failed to save file');
    return buffer;
  };

  openMessageDetail = (messageId: string): void => {
    this.#get().pushPortalView({ messageId, type: PortalViewType.MessageDetail });
  };

  openNotebook = (): void => {
    this.#get().pushPortalView({ type: PortalViewType.Notebook });
  };

  openTaskDetail = (taskId: string): void => {
    this.#get().pushPortalView({ taskId, type: PortalViewType.TaskDetail });
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
