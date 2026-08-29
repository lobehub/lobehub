import type { ChatContextContent } from '@lobechat/types';
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
        chatUploadFileListByContext: { 'topic-a': [{ id: '1' }] as UploadFileItem[] },
      } as FilesStoreState;
      expect(filesSelectors.chatUploadFileList('topic-a')(state)).toEqual([{ id: '1' }]);
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
  describe('chatContextSelections', () => {
    it('returns only the selections owned by the requested conversation', () => {
      const selectionA: ChatContextContent = {
        content: 'selection A',
        id: 'selection-a',
        type: 'text',
      };
      const selectionB: ChatContextContent = {
        content: 'selection B',
        id: 'selection-b',
        type: 'text',
      };
      const state = {
        ...initialState,
        chatContextSelectionsByContext: {
          'topic-a': [selectionA],
          'topic-b': [selectionB],
        },
      } as FilesStoreState;

      expect(fileChatSelectors.chatContextSelections('topic-a')(state)).toEqual([selectionA]);
      expect(fileChatSelectors.chatContextSelections('topic-b')(state)).toEqual([selectionB]);
      expect(fileChatSelectors.chatContextSelections('topic-c')(state)).toEqual([]);
      expect(fileChatSelectors.chatContextSelectionHasItem('topic-a')(state)).toBe(true);
      expect(fileChatSelectors.chatContextSelectionHasItem('topic-c')(state)).toBe(false);
    });

    it('returns the same empty list when no conversation key is available', () => {
      const first = fileChatSelectors.chatContextSelections()(initialState);
      const second = fileChatSelectors.chatContextSelections()(initialState);

      expect(first).toBe(second);
      expect(first).toEqual([]);
    });
  });

  describe('chatRawFileList', () => {
    it('should return a list of raw files', () => {
      const state = {
        chatUploadFileListByContext: {
          'topic-a': [
            { file: { name: 'test1.jpg' } },
            { file: { name: 'test2.jpg' } },
          ] as UploadFileItem[],
        },
      } as unknown as FilesStoreState;

      expect(fileChatSelectors.chatRawFileList('topic-a')(state)).toEqual([
        { name: 'test1.jpg' },
        { name: 'test2.jpg' },
      ]);
    });
  });

  describe('chatUploadFileList', () => {
    it('should return only the requested conversation pending uploads', () => {
      const state = {
        chatUploadFileListByContext: {
          'topic-a': [{ id: '1' }] as UploadFileItem[],
          'topic-b': [{ id: '2' }] as UploadFileItem[],
        },
      } as unknown as FilesStoreState;

      expect(fileChatSelectors.chatUploadFileList('topic-a')(state)).toEqual([{ id: '1' }]);
      expect(fileChatSelectors.chatUploadFileList('topic-b')(state)).toEqual([{ id: '2' }]);
      // A composer with nothing pending must not inherit its neighbour's draft.
      expect(fileChatSelectors.chatUploadFileList('topic-c')(state)).toEqual([]);
    });

    it('returns the same empty list for an unknown conversation', () => {
      const first = fileChatSelectors.chatUploadFileList('topic-a')(initialState);
      const second = fileChatSelectors.chatUploadFileList('topic-b')(initialState);

      expect(first).toBe(second);
    });
  });

  describe('chatUploadFileListHasItem', () => {
    it('should return true if chatUploadFileList has items', () => {
      const state = {
        chatUploadFileListByContext: { 'topic-a': [{ id: '1' }] as UploadFileItem[] },
      } as unknown as FilesStoreState;
      expect(fileChatSelectors.chatUploadFileListHasItem('topic-a')(state)).toBe(true);
    });

    it('should return false if chatUploadFileList is empty', () => {
      const state = {
        chatUploadFileListByContext: { 'topic-a': [] as UploadFileItem[] },
      } as unknown as FilesStoreState;
      expect(fileChatSelectors.chatUploadFileListHasItem('topic-a')(state)).toBe(false);
    });
  });

  describe('isUploadingFiles', () => {
    it('should return true if any file is in uploading status', () => {
      const state = {
        chatUploadFileListByContext: {
          'topic-a': [
            { status: Array.from(UPLOAD_STATUS_SET)[0] },
            { status: 'completed' },
          ] as UploadFileItem[],
        },
      } as unknown as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles('topic-a')(state)).toBe(true);
      // Another composer must not be blocked by this one's upload.
      expect(fileChatSelectors.isUploadingFiles('topic-b')(state)).toBe(false);
    });

    it('should return true if any file has unfinished embedding tasks', () => {
      const state = {
        chatUploadFileListByContext: {
          'topic-a': [
            { status: 'success', tasks: { finishEmbedding: false } },
            { status: 'success', tasks: { finishEmbedding: true } },
          ] as UploadFileItem[],
        },
      } as unknown as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles('topic-a')(state)).toBe(true);
    });

    it('should return false if no files are uploading or have unfinished tasks', () => {
      const state = {
        chatUploadFileListByContext: {
          'topic-a': [
            { status: 'success', tasks: { finishEmbedding: true } },
            { status: 'success' },
          ] as UploadFileItem[],
        },
      } as unknown as FilesStoreState;
      expect(fileChatSelectors.isUploadingFiles('topic-a')(state)).toBe(false);
    });
  });
});
