import {
  MAX_UPLOAD_FILE_SIZE,
  SHARE_VISITOR_MAX_FILE_SIZE,
  UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE,
} from '@lobechat/const';
import { type ChatContextContent } from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageFile } from '@lobechat/utils/compressImage';
import { toast } from '@lobehub/ui';
import { Buffer } from 'buffer.js';
import { t } from 'i18next';

import { withResponseDetail } from '@/components/Error/unreadableResponseMessage';
import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { findUnreadableServerResponseError } from '@/libs/trpc/client/unreadableServerResponse';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { shareChatService } from '@/services/shareChat';
import { UPLOAD_NETWORK_ERROR, UploadRequestError } from '@/services/upload';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { type UploadFileListDispatch } from '@/store/file/reducers/uploadFileList';
import { uploadFileListReducer } from '@/store/file/reducers/uploadFileList';
import { type StoreSetter } from '@/store/types';
import { type FileListItem } from '@/types/files';
import { type UploadFileItem } from '@/types/files/upload';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore } from '../../store';
import {
  isShareFileTooLarge,
  isShareStorageBlockError,
  uploadShareVisitorFile,
} from './shareVisitorUpload';
import { filterSupportedChatUploadFiles } from './uploadGuard';

const n = setNamespace('chat');

type Setter = StoreSetter<FileStore>;
export const createFileSlice = (set: Setter, get: () => FileStore, _api?: unknown) =>
  new FileActionImpl(set, get, _api);

const getTrpcErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('data' in error)) return;

  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === 'string' ? data.code : undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return String(error);
};

export interface ChatUploadOptions {
  /**
   * Upload as an agent-share VISITOR: files go through the share-scoped
   * endpoints onto the CREATOR's account and storage quota (see
   * `uploadShareVisitorFile`) instead of the caller's own file API.
   */
  shareId?: string;
}

/**
 * Id of a chip while its upload is pending, replaced by the file's id once it finishes.
 * Pasted images are all named `image.png`, so the file name alone would let concurrent
 * uploads report to each other's chips and send an image the chip does not show.
 */
const createPendingUploadId = (file: File) => `${file.name}#${createNanoId(8)()}`;

/**
 * Best-effort: `crypto.subtle` is missing outside a secure context (a self-hosted page over
 * plain HTTP from a non-localhost address), where the image is uploaded without dedupe.
 */
const hashImageContent = async (file: File): Promise<string | undefined> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Buffer.from(digest).toString('hex');
  } catch {
    return undefined;
  }
};

/** A failed or cancelled upload is not sent, so a new copy of its image is uploaded again. */
const isLiveUpload = (item: UploadFileItem) =>
  item.status !== 'error' && item.status !== 'cancelled';

/**
 * Drops newly prepared uploads whose content matches an image already in the draft (or
 * earlier in the same batch). A second card would upload the same file again, the server
 * keeps one copy, and the message would name an `[Image #2]` the model never receives.
 * `repastedIds` are the draft cards that matched, so they can show the paste landed.
 */
const withoutDuplicateImages = (
  current: UploadFileItem[],
  prepared: UploadFileItem[],
): { added: UploadFileItem[]; repastedIds: string[] } => {
  const existing = new Map<string, string>();
  for (const item of current) {
    if (item.contentHash && isLiveUpload(item)) existing.set(item.contentHash, item.id);
  }
  const seen = new Set<string>();
  const repastedIds = new Set<string>();

  const added = prepared.filter((item) => {
    if (!item.contentHash) return true;
    const existingId = existing.get(item.contentHash);
    if (existingId !== undefined || seen.has(item.contentHash)) {
      if (existingId !== undefined) repastedIds.add(existingId);
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return false;
    }
    seen.add(item.contentHash);
    return true;
  });

  return { added, repastedIds: [...repastedIds] };
};

const formatShareUploadLimit = () => `${Math.round(SHARE_VISITOR_MAX_FILE_SIZE / 1024 / 1024)} MB`;

const formatUploadLimit = () => `${Math.round(MAX_UPLOAD_FILE_SIZE / 1024 ** 3)} GB`;

/**
 * The file is over the size every upload is held to: the client check in
 * `uploadFileToS3` and the server's input validation both carry this message.
 * Sending it again fails the same way, so it is not offered as a retry.
 */
const isUploadSizeLimitError = (error: unknown) =>
  getErrorMessage(error).includes(UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE);

const getUploadErrorDescription = (error: unknown): string => {
  if (error === UPLOAD_NETWORK_ERROR) return t('upload.networkError', { ns: 'error' });

  if (isUploadSizeLimitError(error)) {
    return t('upload.fileTooLarge', { max: formatUploadLimit(), ns: 'error' });
  }

  // Storage answered the PUT with an error. Its status and code are the only
  // trace of why (the browser's statusText is empty over HTTP/2).
  if (error instanceof UploadRequestError) {
    return t('upload.storageRejected', {
      detail: [`HTTP ${error.status}`, error.code].filter(Boolean).join(' · '),
      ns: 'error',
    });
  }

  // A share upload is admitted by the CREATOR's storage quota, so the block
  // is theirs to lift — never route the visitor to their own plan/usage page.
  if (isShareStorageBlockError(error)) {
    return t('share.visitor.upload.creatorStorageBlocked', { ns: 'agent' });
  }

  if (getTrpcErrorCode(error) === 'FORBIDDEN') {
    return t('upload.permissionDenied', { ns: 'error' });
  }

  // A gateway error page answered instead of the upload API. Its parse error
  // means nothing to the user; the status and request id let support trace it.
  const unreadable = findUnreadableServerResponseError(error);
  if (unreadable) {
    return withResponseDetail(t('upload.serviceUnavailable', { ns: 'error' }), unreadable);
  }

  const reason = getErrorMessage(error).trim();
  // A failed chip must always say why; an empty reason left only a red icon.
  if (!reason) return t('upload.uploadFailed', { ns: 'error' });

  return typeof error === 'string' ? reason : t('upload.unknownError', { ns: 'error', reason });
};

const EMPTY_CHAT_UPLOAD_FILE_LIST: UploadFileItem[] = [];

/** Statuses of a chip whose file has no server row yet (its id is still the pending id). */
const UNSETTLED_UPLOAD_STATUSES = new Set<UploadFileItem['status']>([
  'cancelled',
  'error',
  'pending',
  'processing',
  'uploading',
]);

export class FileActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;
  /**
   * The key each in-flight upload's chip currently lives under. A move
   * (`moveChatUploadFileList`) updates it, so an upload keeps reporting to its
   * own chip instead of resolving by id — a pending id is only the file name,
   * and a same-named upload may appear under the old key later.
   */
  readonly #inFlightUploads = new Set<{ contextKey: string }>();
  /** Cancels an upload when its chip is removed, keyed by the chip's pending id. */
  readonly #uploadAbortControllers = new Map<string, AbortController>();

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #getChatUploadFileList = (contextKey: string): UploadFileItem[] =>
    this.#get().chatUploadFileListByContext[contextKey] ?? EMPTY_CHAT_UPLOAD_FILE_LIST;

  #setChatUploadFileList = (contextKey: string, list: UploadFileItem[], action: string): void => {
    const currentMap = this.#get().chatUploadFileListByContext;

    // Drop emptied buckets so conversations visited once don't pile up keys.
    if (list.length === 0) {
      if (!(contextKey in currentMap)) return;
      const { [contextKey]: _removed, ...nextMap } = currentMap;
      this.#set({ chatUploadFileListByContext: nextMap }, false, action);
      return;
    }

    this.#set(
      { chatUploadFileListByContext: { ...currentMap, [contextKey]: list } },
      false,
      action,
    );
  };

  addChatContextSelection = ({
    contextKey,
    selection,
  }: {
    contextKey: string;
    selection: ChatContextContent;
  }): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    const current = currentMap[contextKey] ?? [];
    const next = [selection, ...current.filter((item) => item.id !== selection.id)];

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('addChatContextSelection'),
    );
  };

  clearChatContextSelections = (contextKey: string): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    if (!(contextKey in currentMap)) return;

    const { [contextKey]: _removed, ...nextMap } = currentMap;
    this.#set({ chatContextSelectionsByContext: nextMap }, false, n('clearChatContextSelections'));
  };

  clearChatUploadFileList = (contextKey: string, submittedIds?: string[]): void => {
    const next = submittedIds
      ? this.#getChatUploadFileList(contextKey).filter((file) => !submittedIds.includes(file.id))
      : [];
    this.#setChatUploadFileList(contextKey, next, n('clearChatUploadFileList'));
  };

  /**
   * Put captured upload items back into the composer list after a send was
   * rejected before any message owned them (e.g. the server refused the turn
   * up front). Items already in the list are skipped by id so a concurrent
   * draft does not end up with duplicates.
   *
   * `order` is the composer's id order before the send. When given, restored and
   * retained items (e.g. a failed upload that never left) go back to those
   * positions; anything newer keeps its place after them.
   */
  restoreChatUploadFileList = (
    contextKey: string,
    files: UploadFileItem[],
    order?: string[],
  ): void => {
    if (files.length === 0) return;

    const current = this.#getChatUploadFileList(contextKey);
    const currentIds = new Set(current.map((file) => file.id));
    const restored = files.filter((file) => !currentIds.has(file.id));
    if (restored.length === 0) return;

    if (!order) {
      this.#get().dispatchChatUploadFileList(contextKey, { files: restored, type: 'addFiles' });
      return;
    }

    const rank = new Map(order.map((id, index) => [id, index]));
    const merged = [...current, ...restored];
    const ranked = merged
      .filter((file) => rank.has(file.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const unranked = merged.filter((file) => !rank.has(file.id));
    this.#setChatUploadFileList(
      contextKey,
      [...ranked, ...unranked],
      n('restoreChatUploadFileList'),
    );
  };

  dispatchChatUploadFileList = (contextKey: string, payload: UploadFileListDispatch): void => {
    const current = this.#getChatUploadFileList(contextKey);
    const nextValue = uploadFileListReducer(current, payload);
    if (nextValue === current) return;

    this.#setChatUploadFileList(contextKey, nextValue, `dispatchChatFileList/${payload.type}`);
  };

  /** Upload half of `moveChatComposerAttachments`. */
  moveChatUploadFileList = (fromContextKey: string, toContextKey: string): void => {
    if (fromContextKey === toContextKey) return;

    // Uploads still being prepared follow the composer even before their chip exists.
    for (const upload of this.#inFlightUploads) {
      if (upload.contextKey === fromContextKey) upload.contextKey = toContextKey;
    }

    const source = this.#getChatUploadFileList(fromContextKey);
    if (source.length === 0) return;

    const sourceIds = new Set(source.map((file) => file.id));
    const target = this.#getChatUploadFileList(toContextKey).filter(
      (file) => !sourceIds.has(file.id),
    );
    const { [fromContextKey]: _removed, ...nextMap } = this.#get().chatUploadFileListByContext;

    this.#set(
      { chatUploadFileListByContext: { ...nextMap, [toContextKey]: [...target, ...source] } },
      false,
      n('moveChatUploadFileList'),
    );
  };

  /**
   * Carry everything a composer has staged — context selections and uploads —
   * to another key, e.g. when a blank conversation becomes a real topic
   * mid-send, so the composer at the new key still shows them.
   */
  moveChatComposerAttachments = (fromContextKey: string, toContextKey: string): void => {
    this.moveChatContextSelections(fromContextKey, toContextKey);
    this.moveChatUploadFileList(fromContextKey, toContextKey);
  };

  moveChatContextSelections = (fromContextKey: string, toContextKey: string): void => {
    if (fromContextKey === toContextKey) return;

    const currentMap = this.#get().chatContextSelectionsByContext;
    const source = currentMap[fromContextKey];
    if (!source || source.length === 0) return;

    const sourceIds = new Set(source.map((item) => item.id));
    const target = currentMap[toContextKey] ?? [];
    const nextTarget = [...source, ...target.filter((item) => !sourceIds.has(item.id))];
    const { [fromContextKey]: _removed, ...nextMap } = currentMap;

    this.#set(
      { chatContextSelectionsByContext: { ...nextMap, [toContextKey]: nextTarget } },
      false,
      n('moveChatContextSelections'),
    );
  };

  removeChatContextSelection = ({ contextKey, id }: { contextKey: string; id: string }): void => {
    const currentMap = this.#get().chatContextSelectionsByContext;
    const current = currentMap[contextKey];
    if (!current) return;

    const next = current.filter((item) => item.id !== id);
    if (next.length === 0) {
      const { [contextKey]: _removed, ...nextMap } = currentMap;
      this.#set(
        { chatContextSelectionsByContext: nextMap },
        false,
        n('removeChatContextSelection'),
      );
      return;
    }

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('removeChatContextSelection'),
    );
  };

  restoreChatContextSelections = (contextKey: string, selections: ChatContextContent[]): void => {
    if (selections.length === 0) return;

    const currentMap = this.#get().chatContextSelectionsByContext;
    const restoredIds = new Set(selections.map((item) => item.id));
    const current = currentMap[contextKey] ?? [];
    const next = [...selections, ...current.filter((item) => !restoredIds.has(item.id))];

    this.#set(
      { chatContextSelectionsByContext: { ...currentMap, [contextKey]: next } },
      false,
      n('restoreChatContextSelections'),
    );
  };

  removeChatUploadFile = async (contextKey: string, id: string): Promise<void> => {
    // Restored entries reference an already-persisted file that still backs the
    // original message — only drop the draft item, never delete the file itself.
    const item = this.#getChatUploadFileList(contextKey).find((entry) => entry.id === id);

    this.#get().dispatchChatUploadFileList(contextKey, { id, type: 'removeFile' });

    // Removing a chip mid-upload cancels the transfer rather than letting it
    // finish in the background into a file nobody sends.
    this.#uploadAbortControllers.get(id)?.abort();

    if (item?.skipRemoveFile) return;

    // Only a settled upload has a server row; until then the id is the pending
    // client id, and an upload that lands after the abort deletes itself.
    if (item && UNSETTLED_UPLOAD_STATUSES.has(item.status)) return;

    // Share uploads are creator-owned rows the visitor's own file API cannot
    // see; the share endpoint deletes them only while still unsent.
    if (item?.shareId) {
      await shareChatService.removeFile(item.shareId, id);
      return;
    }

    await fileService.removeFile(id);
  };

  retryChatUploadFile = async (contextKey: string, id: string): Promise<void> => {
    const item = this.#getChatUploadFileList(contextKey).find((file) => file.id === id);
    if (!item?.agentId || item.retryable === false) return;

    this.#get().dispatchChatUploadFileList(contextKey, { id, type: 'removeFile' });
    await this.uploadChatFiles(contextKey, [item.file], item.agentId, { shareId: item.shareId });
  };

  startAsyncTask = async (
    id: string,
    runner: (id: string) => Promise<string>,
    onFileItemUpdate: (fileItem: FileListItem) => void,
  ): Promise<void> => {
    await runner(id);

    let isFinished = false;

    while (!isFinished) {
      // Poll task status every 2 seconds
      await sleep(2000);

      let fileItem: FileListItem | undefined;

      try {
        const result = await fileService.getKnowledgeItem(id);
        fileItem = result ?? undefined;
      } catch (e) {
        console.error('getFileItem Error:', e);
        continue;
      }

      if (!fileItem) return;

      onFileItemUpdate(fileItem);

      if (fileItem.finishEmbedding) {
        isFinished = true;
      }

      // if error, also break
      else if (fileItem.chunkingStatus === 'error' || fileItem.embeddingStatus === 'error') {
        isFinished = true;
      }
    }
  };

  uploadChatFiles = async (
    contextKey: string,
    rawFiles: File[],
    agentId: string,
    options: ChatUploadOptions = {},
  ): Promise<void> => {
    const { shareId } = options;
    const upload = { contextKey };
    this.#inFlightUploads.add(upload);
    try {
      await this.#uploadChatFilesTo(upload, rawFiles, agentId, shareId);
    } finally {
      this.#inFlightUploads.delete(upload);
    }
  };

  #uploadChatFilesTo = async (
    upload: { contextKey: string },
    rawFiles: File[],
    agentId: string,
    shareId: string | undefined,
  ): Promise<void> => {
    // The chip may be handed to another key mid-upload; dispatch to wherever it is now.
    const dispatchChatUploadFileList = (payload: UploadFileListDispatch) =>
      this.#get().dispatchChatUploadFileList(upload.contextKey, payload);
    // 0. skip file in blacklist
    const filteredFiles = rawFiles.filter((file) => !FILE_UPLOAD_BLACKLIST.includes(file.name));

    // The file-type whitelist only makes sense in plain chat mode, where files are fed
    // directly to the model. In agent mode (tool calls) or heterogeneous agents (Claude
    // Code / Codex, etc.) the agent can parse any file via scripts/terminal, so the
    // whitelist must not apply there. We key off the conversation's own agent id rather
    // than the global current agent, because the chat input can be scoped to a different
    // agent than activeAgentId (e.g. another desktop tab). See lobehub/lobehub#15770.
    //
    // A share VISITOR never has the creator's agent in their agent store, so
    // the selectors below would always say "plain chat" by accident. Make it
    // explicit: share uploads are parsed on the creator's account, so only the
    // parseable whitelist is ever accepted there.
    const agentState = getAgentStoreState();
    const enforceFileTypeWhitelist =
      !!shareId ||
      (!agentByIdSelectors.getAgentEnableModeById(agentId)(agentState) &&
        !agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState));

    const { supportedFiles, unsupportedFiles } = enforceFileTypeWhitelist
      ? filterSupportedChatUploadFiles(filteredFiles)
      : { supportedFiles: filteredFiles, unsupportedFiles: [] as File[] };

    if (unsupportedFiles.length > 0) {
      toast.error(
        t('upload.validation.unsupportedFileType', {
          files: unsupportedFiles.map((file) => file.name).join(', '),
          ns: 'chat',
        }),
      );
    }

    // Share uploads land on the creator's storage: bounded per file, and
    // rejected here rather than after the bytes were already pushed.
    const tooLarge = shareId ? supportedFiles.filter((file) => isShareFileTooLarge(file)) : [];
    if (tooLarge.length > 0) {
      toast.error(
        t('share.visitor.upload.fileTooLarge', {
          max: formatShareUploadLimit(),
          ns: 'agent',
        }),
      );
    }
    const admittedFiles =
      tooLarge.length > 0
        ? supportedFiles.filter((file) => !tooLarge.includes(file))
        : supportedFiles;

    if (admittedFiles.length === 0) return;

    // 1. compress images and add files with base64. Images are hashed first, since
    // compression re-encodes them and the same picture must hash the same every time.
    const prepared = await Promise.all(
      admittedFiles.map(async (rawFile) => {
        const contentHash = rawFile.type.startsWith('image')
          ? await hashImageContent(rawFile)
          : undefined;
        const file = COMPRESSIBLE_IMAGE_TYPES.has(rawFile.type)
          ? await compressImageFile(rawFile)
          : rawFile;
        return { contentHash, file };
      }),
    );

    const preparedItems: UploadFileItem[] = await Promise.all(
      prepared.map(async ({ contentHash, file }) => {
        let previewUrl: string | undefined = undefined;
        let base64Url: string | undefined = undefined;

        // only image and video can be previewed, we create a previewUrl and base64Url for them
        if (file.type.startsWith('image') || file.type.startsWith('video')) {
          const data = await file.arrayBuffer();

          previewUrl = URL.createObjectURL(new Blob([data!], { type: file.type }));

          const base64 = Buffer.from(data!).toString('base64');
          base64Url = `data:${file.type};base64,${base64}`;
        }

        return {
          agentId,
          base64Url,
          contentHash,
          file,
          id: createPendingUploadId(file),
          previewUrl,
          shareId,
          status: 'pending',
        } as UploadFileItem;
      }),
    );

    // Read the list and add to it in one synchronous step, so concurrent pastes of the
    // same image see each other.
    const { added: uploadFiles, repastedIds } = withoutDuplicateImages(
      this.#getChatUploadFileList(upload.contextKey),
      preparedItems,
    );

    if (uploadFiles.length > 0)
      dispatchChatUploadFileList({ files: uploadFiles, type: 'addFiles' });
    const repastedAt = Date.now();
    for (const id of repastedIds)
      dispatchChatUploadFileList({ id, type: 'updateFile', value: { repastedAt } });

    // upload files and process it
    const pools = uploadFiles.map(async ({ file, id: uploadId }) => {
      // Share uploads have no cancellable transfer of their own yet.
      const abortController = shareId ? undefined : new AbortController();
      if (abortController) this.#uploadAbortControllers.set(uploadId, abortController);
      try {
        await this.#uploadChatFile({
          abortController,
          agentId,
          dispatchChatUploadFileList,
          file,
          shareId,
          uploadId,
        });
      } finally {
        this.#uploadAbortControllers.delete(uploadId);
      }
    });

    await Promise.all(pools);
  };

  #uploadChatFile = async ({
    abortController,
    agentId,
    dispatchChatUploadFileList,
    file,
    shareId,
    uploadId,
  }: {
    abortController?: AbortController;
    agentId: string;
    dispatchChatUploadFileList: (payload: UploadFileListDispatch) => void;
    file: File;
    shareId: string | undefined;
    uploadId: string;
  }): Promise<void> => {
    let fileResult: { id: string; url: string } | undefined;

    try {
      fileResult = shareId
        ? await uploadShareVisitorFile({
            file,
            onStatusUpdate: dispatchChatUploadFileList,
            shareId,
            uploadId,
          })
        : await this.#get().uploadWithProgress({
            abortController,
            conversationAgentId: agentId,
            file,
            onStatusUpdate: dispatchChatUploadFileList,
            uploadId,
          });
    } catch (error) {
      if (abortController?.signal.aborted) return;

      if (getErrorMessage(error) === 'UNAUTHORIZED') {
        dispatchChatUploadFileList({ id: uploadId, type: 'removeFile' });
      } else {
        dispatchChatUploadFileList({
          id: uploadId,
          type: 'updateFile',
          value: {
            error: getUploadErrorDescription(error),
            retryable: !isUploadSizeLimitError(error),
            status: 'error',
            uploadState: undefined,
          },
        });
      }
    }

    if (!fileResult) return;

    // The chip was removed while the file record was being created: drop the
    // record too, so a cancelled upload leaves nothing behind.
    if (abortController?.signal.aborted) {
      await fileService.removeFile(fileResult.id).catch((error: unknown) => {
        console.error('Failed to remove cancelled upload:', error);
      });
      return;
    }

    // image don't need to be chunked and embedding
    if (isChunkingUnsupported(file.type)) return;

    // A share file is creator-owned, so the visitor cannot pre-parse it; the
    // run parses it on the creator's account when the turn is set up.
    if (shareId) return;

    await ragService.parseFileContent(fileResult.id);
  };
}

export type FileAction = Pick<FileActionImpl, keyof FileActionImpl>;
