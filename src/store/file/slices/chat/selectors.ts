import { type ChatContextContent } from '@lobechat/types';

import { UPLOAD_STATUS_SET, type UploadFileItem } from '@/types/files/upload';

import { type FilesStoreState } from '../../initialState';
import { DEFAULT_CHAT_UPLOAD_CONTEXT } from './initialState';

const EMPTY_CHAT_CONTEXT_SELECTIONS: ChatContextContent[] = [];
const EMPTY_CHAT_UPLOAD_FILES: UploadFileItem[] = [];

/**
 * Resolve the bucket a composer reads and writes.
 *
 * Shared by every selector and action so a host that has not been given a
 * context key still reads back exactly what it uploaded.
 */
export const chatUploadContextKey = (contextKey?: string): string =>
  contextKey || DEFAULT_CHAT_UPLOAD_CONTEXT;

const chatUploadFileList = (contextKey?: string) => (s: FilesStoreState) =>
  s.chatUploadFileListByContext[chatUploadContextKey(contextKey)] ?? EMPTY_CHAT_UPLOAD_FILES;
const chatContextSelections = (contextKey?: string) => (s: FilesStoreState) =>
  contextKey
    ? (s.chatContextSelectionsByContext[contextKey] ?? EMPTY_CHAT_CONTEXT_SELECTIONS)
    : EMPTY_CHAT_CONTEXT_SELECTIONS;
const isImageUploading = (s: FilesStoreState) => s.uploadingIds.length > 0;

const chatRawFileList = (contextKey?: string) => (s: FilesStoreState) =>
  chatUploadFileList(contextKey)(s).map((item) => item.file);
const chatUploadFileListHasItem = (contextKey?: string) => (s: FilesStoreState) =>
  chatUploadFileList(contextKey)(s).length > 0;
const chatContextSelectionHasItem = (contextKey?: string) => (s: FilesStoreState) =>
  contextKey ? (s.chatContextSelectionsByContext[contextKey]?.length ?? 0) > 0 : false;

const isUploadingFiles = (contextKey?: string) => (s: FilesStoreState) =>
  chatUploadFileList(contextKey)(s).some(
    (file) =>
      // is file status in uploading
      UPLOAD_STATUS_SET.has(file.status) ||
      // or file has tasks but not finish embedding
      (file.tasks && !file.tasks?.finishEmbedding),
  );

export const filesSelectors = {
  chatUploadFileList,
  isImageUploading,
};

export const fileChatSelectors = {
  chatContextSelectionHasItem,
  chatContextSelections,
  chatRawFileList,
  chatUploadFileList,
  chatUploadFileListHasItem,
  isUploadingFiles,
};
