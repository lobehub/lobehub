import { describe, expect, it } from 'vitest';

import { type FilesStoreState } from '@/store/file/initialState';
import { initialState } from '@/store/file/initialState';
import { type UploadFileItem } from '@/types/files/upload';
import { UPLOAD_STATUS_SET } from '@/types/files/upload';

import { fileChatSelectors, filesSelectors } from './selectors';

describe('filesSelectors', () => {
  describe('chatUploadFileList', () => {
    it('should return the chatUploadFileList from state', () => {
      const state = {
        ...initialState,
        chatUploadFileList: [{ id: '1' }] as UploadFileItem[],
      } as FilesStoreState;
      expect(filesSelectors.chatUploadFileList(state)).toEqual([{ id: '1' }]);
    });
  });

  describe('isImageUploading', () => {
    it('should return true if there are uploading ids', () => {
      const state = { uploadingIds: ['1', '2'] } as FilesStoreState;
      expect(filesSelectors.isImageUploading(state)).toBe(true);
    });

    it('should return false if there are no uploading ids', () => {
      const state = { uploadingIds: [] as string[] } as FilesStoreState;
      expect(filesSelectors.isImageUploading(state)).toBe(false);
    });
  });
});

describe('fileChatSelectors', () => {
  describe('chatRawFileList', () => {
    it('should return a list of raw files', () => {
      const state = {
        chatUploadFileList: [
          { file: { name: 'test1.jpg' } },
          { file: { name: 'test2.jpg' } },
        ] as UploadFileItem[],
      } as FilesStoreState;

      expect(fileChatSelectors.chatRawFileList(state)).toEqual([
        { name: 'test1.jpg' },
        { name: 'test2.jpg' },
      ]);
    });
  });

  describe('chatUploadFileList', () => {
    it('should return the chatUploadFileList from state', () => {
      const state = {
        chatUploadFileList: [{ id: '1' }] as UploadFileItem[],
      } as FilesStoreState;
      expect(fileChatSelectors.chatUploadFileList(state)).toEqual([{ id: '1' }]);
    });
  });

  describe('chatUploadFileListHasItem', () => {
    it('should return true if chatUploadFileList has items', () => {
      const state = { chatUploadFileList: [{ id: '1' }] as UploadFileItem[] } as FilesStoreState;
      expect(fileChatSelectors.chatUploadFileListHasItem(state)).toBe(true);
    });

    it('should return false if chatUploadFileList is empty', () => {
      const state = { chatUploadFileList: [] as UploadFileItem[] } as FilesStoreState;
      expect(fileChatSelectors.chatUploadFileListHasItem(state)).toBe(false);
    });
  });

  describe('isUploadingFiles', () => {
    it('should return true if any file is in uploading status', () => {
      const state = {
        chatUploadFileList: [
          { status: Array.from(UPLOAD_STATUS_SET)[0] },
          { status: 'completed' },
        ] as UploadFileItem[],
      } as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles(state)).toBe(true);
    });

    it('should return true if any file has unfinished embedding tasks', () => {
      const state = {
        chatUploadFileList: [
          { status: 'success', tasks: { finishEmbedding: false } },
          { status: 'success', tasks: { finishEmbedding: true } },
        ] as UploadFileItem[],
      } as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles(state)).toBe(true);
    });

    it('should return false if no files are uploading or have unfinished tasks', () => {
      const state: FilesStoreState = {
        chatUploadFileList: [
          { status: 'success', tasks: { finishEmbedding: true } },
          { status: 'success' },
        ] as UploadFileItem[],
      } as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles(state)).toBe(false);
    });
  });
});
