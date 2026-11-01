import { type ChatContextContent } from '@lobechat/types';

import { UPLOAD_STATUS_SET } from '@/types/files/upload';

import { type FilesStoreState } from '../../initialState';

const EMPTY_CHAT_CONTEXT_SELECTIONS: ChatContextContent[] = [];

const chatUploadFileList = (s: FilesStoreState) => s.chatUploadFileList;
const chatContextSelections = (contextKey?: string) => (s: FilesStoreState) =>
  contextKey
    ? (s.chatContextSelectionsByContext[contextKey] ?? EMPTY_CHAT_CONTEXT_SELECTIONS)
    : EMPTY_CHAT_CONTEXT_SELECTIONS;
const isImageUploading = (s: FilesStoreState) => s.uploadingIds.length > 0;

const chatRawFileList = (s: FilesStoreState) => s.chatUploadFileList.map((item) => item.file);
const chatUploadFileListHasItem = (s: FilesStoreState) => s.chatUploadFileList.length > 0;
const chatContextSelectionHasItem = (contextKey?: string) => (s: FilesStoreState) =>
  contextKey ? (s.chatContextSelectionsByContext[contextKey]?.length ?? 0) > 0 : false;

const isUploadingFiles = (s: FilesStoreState) =>
  s.chatUploadFileList.some(
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
