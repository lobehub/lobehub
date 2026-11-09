import type { UploadFileItem } from '@/types/files/upload';

import type { FailedSendDraft } from './initialState';

const STORAGE_KEY = 'lobehub:failed-send-drafts:v1';
const MAX_DRAFTS = 32;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PersistedUploadFile = Omit<UploadFileItem, 'abortController' | 'file'> & {
  file?: { lastModified?: number; name: string; size?: number; type?: string };
};

type PersistedFailedSendDraft = Omit<FailedSendDraft, 'files'> & {
  files?: PersistedUploadFile[];
};

const getStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const serializeFile = (file: UploadFileItem): PersistedUploadFile => {
  const { abortController: _abortController, file: sourceFile, ...rest } = file;
  return {
    ...rest,
    file: sourceFile
      ? {
          lastModified: sourceFile.lastModified,
          name: sourceFile.name,
          size: sourceFile.size,
          type: sourceFile.type,
        }
      : undefined,
  };
};

const deserializeFile = (file: PersistedUploadFile): UploadFileItem => {
  const { file: fileMetadata, ...rest } = file;
  const restoredFile =
    fileMetadata && typeof File !== 'undefined'
      ? new File([], fileMetadata.name, {
          lastModified: fileMetadata.lastModified,
          type: fileMetadata.type,
        })
      : undefined;

  return { ...rest, file: restoredFile as File } as UploadFileItem;
};

const trimDrafts = (
  drafts: Record<string, FailedSendDraft[]>,
): Record<string, FailedSendDraft[]> => {
  const now = Date.now();
  const entries = Object.entries(drafts)
    .flatMap(([contextKey, contextDrafts]) =>
      contextDrafts
        .filter((draft) => !draft.createdAt || now - draft.createdAt <= MAX_AGE_MS)
        .map((draft) => ({ contextKey, draft })),
    )
    .sort((a, b) => (b.draft.createdAt ?? 0) - (a.draft.createdAt ?? 0))
    .slice(0, MAX_DRAFTS);

  return entries.reduce<Record<string, FailedSendDraft[]>>((result, { contextKey, draft }) => {
    (result[contextKey] ||= []).push(draft);
    return result;
  }, {});
};

export const loadFailedSendDrafts = (): Record<string, FailedSendDraft[]> => {
  const storage = getStorage();
  if (!storage) return {};

  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Record<
      string,
      PersistedFailedSendDraft[]
    >;
    return trimDrafts(
      Object.fromEntries(
        Object.entries(parsed).map(([contextKey, drafts]) => [
          contextKey,
          drafts.map((draft) => ({
            ...draft,
            files: draft.files?.map(deserializeFile),
          })),
        ]),
      ),
    );
  } catch {
    return {};
  }
};

export const persistFailedSendDrafts = (drafts: Record<string, FailedSendDraft[]>): void => {
  const storage = getStorage();
  if (!storage) return;

  try {
    const trimmed = trimDrafts(drafts);
    const persisted = Object.fromEntries(
      Object.entries(trimmed).map(([contextKey, contextDrafts]) => [
        contextKey,
        contextDrafts.map(({ files, ...draft }) => ({
          ...draft,
          files: files?.map(serializeFile),
        })),
      ]),
    );
    storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage can be unavailable or full; the in-memory recovery remains usable.
  }
};
