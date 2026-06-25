import { describe, expect, it } from 'vitest';

import { initialState } from '@/store/file/initialState';

import { fileManagerSelectors } from './selectors';

describe('fileManagerSelectors', () => {
  describe('getFileByChunkTargetId', () => {
    it('should find resources by linked file id when they are not in fileList', () => {
      const state = {
        ...initialState,
        fileList: [],
        resourceList: [
          {
            createdAt: new Date(),
            fileId: 'file_1',
            fileType: 'text/plain',
            id: 'docs_1',
            name: 'Document-backed file',
            size: 1,
            sourceType: 'file',
            updatedAt: new Date(),
          },
        ],
      } as any;

      expect(fileManagerSelectors.getFileByChunkTargetId('file_1')(state)).toMatchObject({
        fileId: 'file_1',
        id: 'docs_1',
      });
    });

    it('should prefer fileList items over resourceList items', () => {
      const state = {
        ...initialState,
        fileList: [
          {
            createdAt: new Date(),
            embeddingError: null,
            fileId: 'file_1',
            fileType: 'text/plain',
            finishEmbedding: false,
            id: 'file_1',
            name: 'File list item',
            size: 1,
            sourceType: 'file',
            updatedAt: new Date(),
            url: 'files/file-1.txt',
          },
        ],
        resourceList: [
          {
            createdAt: new Date(),
            fileId: 'file_1',
            fileType: 'text/plain',
            id: 'docs_1',
            name: 'Resource list item',
            size: 1,
            sourceType: 'file',
            updatedAt: new Date(),
          },
        ],
      } as any;

      expect(fileManagerSelectors.getFileByChunkTargetId('file_1')(state)).toMatchObject({
        id: 'file_1',
        name: 'File list item',
      });
    });

    it('should find resources from resourceMap when they are off the visible list', () => {
      const state = {
        ...initialState,
        fileList: [],
        resourceList: [],
        resourceMap: new Map([
          [
            'docs_1',
            {
              createdAt: new Date(),
              fileId: 'file_1',
              fileType: 'text/plain',
              id: 'docs_1',
              name: 'Mapped resource',
              size: 1,
              sourceType: 'file',
              updatedAt: new Date(),
            },
          ],
        ]),
      } as any;

      expect(fileManagerSelectors.getFileByChunkTargetId('file_1')(state)).toMatchObject({
        fileId: 'file_1',
        id: 'docs_1',
      });
    });
  });
});
