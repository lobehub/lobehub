import type { StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn, type UseBoundStoreWithEqualityFn } from 'zustand/traditional';

import { isHtmlFile } from '@/components/HtmlPreview/fileType';
import {
  cacheScope,
  createReplicaSlice,
  createReplicaState,
  recordLens,
  type ReplicaState,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { cloudSandboxService } from '@/services/cloudSandbox';
import { isTerminalLocalFileError } from '@/services/electron/localFileService';
import { type LocalFilePreview, projectFileService } from '@/services/projectFile';

import {
  localFilePreviewKey,
  localFilePreviewResource,
  type LocalFilePreviewTarget,
  localFilePreviewTargetFromKey,
  toPersistedLocalFilePreview,
} from './projection';

export {
  isPersistableLocalFilePreviewKey,
  localFilePreviewKey,
  localFilePreviewResource,
  type LocalFilePreviewTarget,
  MAX_PERSISTED_PREVIEW_CHARS,
  MAX_PERSISTED_PREVIEWS,
  toPersistedLocalFilePreview,
} from './projection';

/**
 * Live-read a text file from the topic's cloud sandbox via the `readLocalFile`
 * sandbox tool. There is no durable copy anywhere — a recycled sandbox (or any
 * tool failure) rejects, surfacing the sandbox-unavailable empty state.
 */
const fetchSandboxFilePreview = async (
  path: string,
  topicId: string,
): Promise<LocalFilePreview> => {
  // `readLocalFile` defaults an omitted range to the first 200 lines — always
  // request the whole file for previews so long files don't render truncated.
  const result = await cloudSandboxService.callTool(
    'readLocalFile',
    { fullContent: true, path },
    { topicId },
  );
  if (!result.success || typeof result.result?.content !== 'string')
    throw new Error(result.error?.message || 'Failed to read sandbox file');

  return {
    content: result.result.content,
    contentType: result.result.mimeType || 'text/plain',
    type: 'text',
  };
};

const fetchLocalFilePreview = (key: string): Promise<LocalFilePreview> => {
  const { allowExternalFile, deviceId, filePath, sandboxTopicId, workingDirectory } =
    localFilePreviewTargetFromKey(key);
  if (sandboxTopicId) return fetchSandboxFilePreview(filePath, sandboxTopicId);

  // A local HTML file resolves its relative URLs against sibling files.
  const resourceScope = !deviceId && isHtmlFile({ path: filePath }) ? 'workspace' : undefined;
  return projectFileService.getLocalFilePreview({
    allowExternalFile,
    deviceId,
    path: filePath,
    ...(resourceScope && { resourceScope }),
    workingDirectory,
  });
};

/** What `useFetchPreview` reports; the preview itself is read with `useLocalFilePreview`. */
export interface LocalFilePreviewSyncResult extends ReplicaSyncResult {
  /** No preview yet (neither persisted nor fetched) and no error. */
  isLoading: boolean;
}

export interface LocalFilePreviewStoreState {
  /** Previews by {@link localFilePreviewKey}. */
  previewMap: Record<string, LocalFilePreview>;
  /** Replica bookkeeping for `previewMap`. */
  previewReplica: ReplicaState<LocalFilePreview>;
}

interface LocalFilePreviewStore extends LocalFilePreviewStoreState {
  /**
   * Start a save of `target`: captures the identity (user / workspace scope) the
   * save runs under and returns the commit that folds the saved text body into
   * the preview, so a reload paints the saved file. The commit is a no-op once
   * another identity is active — the body belongs to the scope that wrote it.
   */
  beginSave: (target: LocalFilePreviewTarget) => (content: string) => void;
  /** Re-read the file from its device / sandbox. */
  refreshPreview: (target: LocalFilePreviewTarget) => Promise<unknown>;
  /** Fetch orchestration only; read the preview with `useLocalFilePreview`. */
  useFetchPreview: (
    target: LocalFilePreviewTarget | undefined,
    enabled?: boolean,
  ) => LocalFilePreviewSyncResult;
}

export const initialLocalFilePreviewState: LocalFilePreviewStoreState = {
  previewMap: {},
  previewReplica: createReplicaState(),
};

/**
 * Annotated for the same reason as `useProjectDirectoryStore`: `useFetchPreview`
 * reads this store inside its initializer, which would otherwise make the
 * equality-fn overload infer its type circularly.
 */
export const useLocalFilePreviewStore: UseBoundStoreWithEqualityFn<
  StoreApi<LocalFilePreviewStore>
> = createWithEqualityFn<LocalFilePreviewStore>()((set, get) => {
  /**
   * Saves folded into each preview (by key). A read started before a save may
   * still hold the pre-save file; once the save lands it must not replace the
   * confirmed content — the same guard as the document detail's adoptions.
   */
  const saveGenerations = new Map<string, number>();

  const previews = createReplicaSlice(localFilePreviewResource, {
    actionPrefix: 'localFilePreview/previews',
    fetcher: async (key) => {
      const savedBefore = saveGenerations.get(key) ?? 0;
      const preview = await fetchLocalFilePreview(key);
      const current = get().previewMap[key];
      if ((saveGenerations.get(key) ?? 0) === savedBefore || !current) return preview;
      // A save landed while this read was in flight: keep the saved body, but
      // take the rest of the fresh read — notably the `resourceBaseUrl` an HTML
      // preview needs for its relative assets (never persisted, so the cached
      // copy has none).
      return preview.type === 'text' && current.type === 'text'
        ? { ...preview, content: current.content }
        : current;
    },
    effects: {
      // The file was deleted or may no longer be read (desktop protocol 404 /
      // 403): drop the cached text — on screen and in IndexedDB — so the portal
      // reports it instead of rehydrating the obsolete body after a reload.
      // Transient failures keep it (stale-while-revalidate).
      onError: (error, _key, { key, scope }) => {
        if (key && isTerminalLocalFileError(error)) previews.remove(key, scope);
      },
    },
    get,
    set,
    stateKey: 'previewReplica',
    toPersisted: toPersistedLocalFilePreview,
    view: recordLens<LocalFilePreviewStore, LocalFilePreview>('previewMap'),
  });

  return {
    ...initialLocalFilePreviewState,

    beginSave: (target) => {
      const key = localFilePreviewKey(target);
      const scope = cacheScope.get();
      return (content) => {
        // The write settled after an account / workspace switch: `update` writes
        // the active scope, which would plant this file body in another identity.
        if (cacheScope.get() !== scope) return;
        saveGenerations.set(key, (saveGenerations.get(key) ?? 0) + 1);
        previews.update(key, (preview) =>
          preview?.type === 'text' ? { ...preview, content } : preview,
        );
      };
    },
    refreshPreview: (target) => previews.revalidate(localFilePreviewKey(target)),
    useFetchPreview: (target, enabled = true) => {
      const key = target ? localFilePreviewKey(target) : undefined;
      // The file's content is not something the user expects to change on a
      // tab refocus; reloads are explicit (toolbar / `…` menu).
      const sync = previews.useSync(key, { enabled, revalidateOnFocus: false });
      const hasPreview = useLocalFilePreviewStore((state) =>
        key ? state.previewMap[key] !== undefined : false,
      );
      return { ...sync, isLoading: enabled && !!key && !hasPreview && sync.error == null };
    },
  };
}, shallow);

/** The preview of one file, or `undefined` while nothing is loaded for it. */
export const useLocalFilePreview = (target: LocalFilePreviewTarget | undefined) =>
  useLocalFilePreviewStore((state) =>
    target ? state.previewMap[localFilePreviewKey(target)] : undefined,
  );
