import { filesSelectors as imageFilesSelectors } from './slices/chat';

export const filesSelectors = {
  ...imageFilesSelectors,
};

export { fileChatSelectors } from './slices/chat/selectors';
export { documentSelectors } from './slices/document';
export * from './slices/fileManager/selectors';
