import { act, renderHook, waitFor } from '@testing-library/react';
import { mutate } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILE_UPLOAD_BLACKLIST } from '@/const/file';
import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { ragService } from '@/services/rag';
import { FileListItem } from '@/types/files';
import { UploadFileItem } from '@/types/files/upload';

import { useFileStore as useStore } from '../../store';

vi.mock('zustand/traditional');

// Mock SWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock lambdaClient
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    file: {
      getFileItemById: { query: vi.fn() },
      getFiles: { query: vi.fn() },
      removeFileAsyncTask: { mutate: vi.fn() },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(
    {
      creatingChunkingTaskIds: [],
      creatingEmbeddingTaskIds: [],
      dockUploadFileList: [],
      fileList: [],
      queryListParams: undefined,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileManagerActions', () => {
  describe('dispatchDockFileList', () => {
    it('should update dockUploadFileList with new value', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.dispatchDockFileList({
          atStart: true,
          files: [{ file: new File([], 'test.txt'), id: 'file-1', status: 'pending' }],
          type: 'addFiles',
        });
      });

      expect(result.current.dockUploadFileList).toHaveLength(1);
      expect(result.current.dockUploadFileList[0].id).toBe('file-1');
    });

    it('should not update state if reducer returns same value', () => {
      const { result } = renderHook(() => useStore());

      const initialList = result.current.dockUploadFileList;

      // This tests the early return when value hasn't changed
      act(() => {
        useStore.setState({ dockUploadFileList: initialList });
      });

      expect(result.current.dockUploadFileList).toBe(initialList);
    });

    it('should handle updateFileStatus dispatch', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          dockUploadFileList: [
            { file: new File([], 'test.txt'), id: 'file-1', status: 'pending' },
          ] as UploadFileItem[],
        });
      });

      act(() => {
        result.current.dispatchDockFileList({
          id: 'file-1',
          status: 'success',
          type: 'updateFileStatus',
        });
      });

      expect(result.current.dockUploadFileList[0].status).toBe('success');
    });

    it('should handle removeFile dispatch', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({
          dockUploadFileList: [
            { file: new File([], 'test.txt'), id: 'file-1', status: 'pending' },
          ] as UploadFileItem[],
        });
      });

      act(() => {
        result.current.dispatchDockFileList({
          id: 'file-1',
          type: 'removeFile',
        });
      });

      expect(result.current.dockUploadFileList).toHaveLength(0);
    });
  });

  describe('embeddingChunks', () => {
    it('should toggle embedding ids and create tasks', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createEmbeddingChunksTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.embeddingChunks(['file-1', 'file-2']);
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(createTaskSpy).toHaveBeenCalledTimes(2);
      expect(createTaskSpy).toHaveBeenCalledWith('file-1');
      expect(createTaskSpy).toHaveBeenCalledWith('file-2');
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2'], false);
    });

    it('should handle errors gracefully and still complete', async () => {
      const { result } = renderHook(() => useStore());

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ragService, 'createEmbeddingChunksTask').mockRejectedValue(new Error('Task failed'));
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.embeddingChunks(['file-1']);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('parseFilesToChunks', () => {
    it('should toggle parsing ids and create parse tasks', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createParseFileTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1', 'file-2']);
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(createTaskSpy).toHaveBeenCalledTimes(2);
      expect(createTaskSpy).toHaveBeenCalledWith('file-1', undefined);
      expect(createTaskSpy).toHaveBeenCalledWith('file-2', undefined);
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1', 'file-2'], false);
    });

    it('should pass skipExist parameter to createParseFileTask', async () => {
      const { result } = renderHook(() => useStore());

      const createTaskSpy = vi
        .spyOn(ragService, 'createParseFileTask')
        .mockResolvedValue(undefined as any);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1'], { skipExist: true });
      });

      expect(createTaskSpy).toHaveBeenCalledWith('file-1', true);
    });

    it('should handle errors gracefully', async () => {
      const { result } = renderHook(() => useStore());

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(ragService, 'createParseFileTask').mockRejectedValue(new Error('Parse failed'));
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');

      await act(async () => {
        await result.current.parseFilesToChunks(['file-1']);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('pushDockFileList', () => {
    it('should filter blacklisted files and upload', async () => {
      const { result } = renderHook(() => useStore());

      const validFile = new File(['content'], 'valid.txt', { type: 'text/plain' });
      const blacklistedFile = new File(['content'], FILE_UPLOAD_BLACKLIST[0], {
        type: 'text/plain',
      });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([validFile, blacklistedFile]);
      });

      // Should only dispatch for the valid file
      expect(dispatchSpy).toHaveBeenCalledWith({
        atStart: true,
        files: [{ file: validFile, id: validFile.name, status: 'pending' }],
        type: 'addFiles',
      });
      expect(uploadSpy).toHaveBeenCalledTimes(1);
      expect(uploadSpy).toHaveBeenCalledWith({
        file: validFile,
        knowledgeBaseId: undefined,
        onStatusUpdate: expect.any(Function),
      });
      expect(refreshSpy).toHaveBeenCalled();
      // Should auto-parse text files
      expect(parseSpy).toHaveBeenCalledWith(['file-1'], { skipExist: false });
    });

    it('should upload files with knowledgeBaseId', async () => {
      const { result } = renderHook(() => useStore());

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValue({ id: 'file-1', url: 'http://example.com/file-1' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([file], 'kb-123');
      });

      expect(uploadSpy).toHaveBeenCalledWith({
        file,
        knowledgeBaseId: 'kb-123',
        onStatusUpdate: expect.any(Function),
      });
    });

    it('should call onStatusUpdate during upload', async () => {
      const { result } = renderHook(() => useStore());

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      const uploadSpy = vi
        .spyOn(result.current, 'uploadWithProgress')
        .mockImplementation(async ({ onStatusUpdate }) => {
          onStatusUpdate?.({ id: file.name, type: 'updateFile', value: { status: 'uploading' } });
          return { id: 'file-1', url: 'http://example.com/file-1' };
        });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();
      const dispatchSpy = vi.spyOn(result.current, 'dispatchDockFileList');

      await act(async () => {
        await result.current.pushDockFileList([file]);
      });

      expect(uploadSpy).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('should handle empty file list', async () => {
      const { result } = renderHook(() => useStore());

      const uploadSpy = vi.spyOn(result.current, 'uploadWithProgress');
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList');
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks');

      await act(async () => {
        await result.current.pushDockFileList([]);
      });

      expect(uploadSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should auto-embed files that support chunking', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });
      const pdfFile = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile, pdfFile]);
      });

      // Should auto-parse both files that support chunking
      expect(parseSpy).toHaveBeenCalledWith(['file-1', 'file-2'], { skipExist: false });
    });

    it('should skip auto-embed for unsupported file types (images/videos/audio)', async () => {
      const { result } = renderHook(() => useStore());

      const imageFile = new File(['image content'], 'image.png', { type: 'image/png' });
      const videoFile = new File(['video content'], 'video.mp4', { type: 'video/mp4' });
      const audioFile = new File(['audio content'], 'audio.mp3', { type: 'audio/mpeg' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' })
        .mockResolvedValueOnce({ id: 'file-3', url: 'http://example.com/file-3' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([imageFile, videoFile, audioFile]);
      });

      // Should not auto-parse unsupported files
      expect(parseSpy).not.toHaveBeenCalled();
    });

    it('should auto-embed only supported files in mixed upload', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });
      const imageFile = new File(['image content'], 'image.png', { type: 'image/png' });
      const pdfFile = new File(['pdf content'], 'doc.pdf', { type: 'application/pdf' });

      vi.spyOn(result.current, 'uploadWithProgress')
        .mockResolvedValueOnce({ id: 'file-1', url: 'http://example.com/file-1' })
        .mockResolvedValueOnce({ id: 'file-2', url: 'http://example.com/file-2' })
        .mockResolvedValueOnce({ id: 'file-3', url: 'http://example.com/file-3' });
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile, imageFile, pdfFile]);
      });

      // Should only auto-parse text and pdf files, skip image
      expect(parseSpy).toHaveBeenCalledWith(['file-1', 'file-3'], { skipExist: false });
    });

    it('should skip auto-embed when upload fails', async () => {
      const { result } = renderHook(() => useStore());

      const textFile = new File(['text content'], 'doc.txt', { type: 'text/plain' });

      vi.spyOn(result.current, 'uploadWithProgress').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();
      const parseSpy = vi.spyOn(result.current, 'parseFilesToChunks').mockResolvedValue();

      await act(async () => {
        await result.current.pushDockFileList([textFile]);
      });

      // Should not auto-parse when upload returns undefined
      expect(parseSpy).not.toHaveBeenCalled();
    });
  });

  describe('reEmbeddingChunks', () => {
    it('should skip if already creating task', async () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');

      await act(async () => {
        await result.current.reEmbeddingChunks('file-1');
      });

      expect(toggleSpy).not.toHaveBeenCalled();
      expect(lambdaClient.file.removeFileAsyncTask.mutate).not.toHaveBeenCalled();
    });

    it('should remove old task and create new embedding task', async () => {
      const { result } = renderHook(() => useStore());

      const toggleSpy = vi.spyOn(result.current, 'toggleEmbeddingIds');
      vi.mocked(lambdaClient.file.removeFileAsyncTask.mutate).mockResolvedValue(undefined as any);
      const createTaskSpy = vi
        .spyOn(ragService, 'createEmbeddingChunksTask')
        .mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.reEmbeddingChunks('file-1');
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1']);
      expect(lambdaClient.file.removeFileAsyncTask.mutate).toHaveBeenCalledWith({
        id: 'file-1',
        type: 'embedding',
      });
      expect(createTaskSpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('reParseFile', () => {
    it('should toggle parsing and retry parse', async () => {
      const { result } = renderHook(() => useStore());

      const toggleSpy = vi.spyOn(result.current, 'toggleParsingIds');
      const retrySpy = vi.spyOn(ragService, 'retryParseFile').mockResolvedValue(undefined as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.reParseFile('file-1');
      });

      expect(toggleSpy).toHaveBeenCalledWith(['file-1']);
      expect(retrySpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalled();
      expect(toggleSpy).toHaveBeenCalledWith(['file-1'], false);
    });
  });

  describe('refreshFileList', () => {
    it('should call mutate with correct key', async () => {
      const { result } = renderHook(() => useStore());

      const params = { category: 'all' };
      act(() => {
        useStore.setState({ queryListParams: params });
      });

      await act(async () => {
        await result.current.refreshFileList();
      });

      expect(mutate).toHaveBeenCalledWith(['useFetchFileManage', params]);
    });

    it('should call mutate with undefined params', async () => {
      const { result } = renderHook(() => useStore());

      await act(async () => {
        await result.current.refreshFileList();
      });

      expect(mutate).toHaveBeenCalledWith(['useFetchFileManage', undefined]);
    });
  });

  describe('removeAllFiles', () => {
    it('should call fileService.removeAllFiles', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeAllFiles').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeAllFiles();
      });

      expect(removeSpy).toHaveBeenCalled();
    });
  });

  describe('removeFileItem', () => {
    it('should remove file and refresh list', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeFile').mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.removeFileItem('file-1');
      });

      expect(removeSpy).toHaveBeenCalledWith('file-1');
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('removeFiles', () => {
    it('should remove multiple files and refresh list', async () => {
      const { result } = renderHook(() => useStore());

      const removeSpy = vi.spyOn(fileService, 'removeFiles').mockResolvedValue(undefined);
      const refreshSpy = vi.spyOn(result.current, 'refreshFileList').mockResolvedValue();

      await act(async () => {
        await result.current.removeFiles(['file-1', 'file-2']);
      });

      expect(removeSpy).toHaveBeenCalledWith(['file-1', 'file-2']);
      expect(refreshSpy).toHaveBeenCalled();
    });
  });

  describe('toggleEmbeddingIds', () => {
    it('should add ids when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1', 'file-2']);
    });

    it('should remove ids when loading is false', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1', 'file-2', 'file-3'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2'], false);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-3']);
    });

    it('should toggle ids when loading is undefined', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1', 'file-2']);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-2']);
    });

    it('should handle empty initial state', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleEmbeddingIds(['file-1'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1']);
    });

    it('should not duplicate ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingEmbeddingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleEmbeddingIds(['file-1'], true);
      });

      expect(result.current.creatingEmbeddingTaskIds).toEqual(['file-1']);
    });
  });

  describe('toggleParsingIds', () => {
    it('should add ids when loading is true', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1', 'file-2']);
    });

    it('should remove ids when loading is false', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1', 'file-2', 'file-3'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2'], false);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-3']);
    });

    it('should toggle ids when loading is undefined', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1', 'file-2']);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-2']);
    });

    it('should handle empty initial state', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.toggleParsingIds(['file-1'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1']);
    });

    it('should not duplicate ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ creatingChunkingTaskIds: ['file-1'] });
      });

      act(() => {
        result.current.toggleParsingIds(['file-1'], true);
      });

      expect(result.current.creatingChunkingTaskIds).toEqual(['file-1']);
    });
  });

  describe('useFetchFileItem', () => {
    it('should not fetch when id is undefined', () => {
      const { result } = renderHook(() => useStore());

      renderHook(() => result.current.useFetchFileItem(undefined));

      expect(lambdaClient.file.getFileItemById.query).not.toHaveBeenCalled();
    });

    it('should fetch file item when id is provided', async () => {
      const { result } = renderHook(() => useStore());

      const mockFile: FileListItem = {
        chunkCount: null,
        chunkingError: null,
        createdAt: new Date(),
        embeddingError: null,
        fileType: 'text/plain',
        finishEmbedding: false,
        id: 'file-1',
        name: 'test.txt',
        size: 100,
        updatedAt: new Date(),
        url: 'http://example.com/test.txt',
      };

      vi.mocked(lambdaClient.file.getFileItemById.query).mockResolvedValue(mockFile);

      const { result: swrResult } = renderHook(() => result.current.useFetchFileItem('file-1'));

      await waitFor(() => {
        expect(swrResult.current.data).toEqual(mockFile);
      });
    });
  });

  describe('useFetchFileManage', () => {
    it('should fetch file list with params', async () => {
      const { result } = renderHook(() => useStore());

      const mockFiles: FileListItem[] = [
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-1',
          name: 'test1.txt',
          size: 100,
          updatedAt: new Date(),
          url: 'http://example.com/test1.txt',
        },
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-2',
          name: 'test2.txt',
          size: 200,
          updatedAt: new Date(),
          url: 'http://example.com/test2.txt',
        },
      ];

      vi.mocked(lambdaClient.file.getFiles.query).mockResolvedValue(mockFiles);

      const params = { category: 'all' as any };
      const { result: swrResult } = renderHook(() => result.current.useFetchFileManage(params));

      await waitFor(() => {
        expect(swrResult.current.data).toEqual(mockFiles);
      });
    });

    it('should update store state on successful fetch', async () => {
      const { result } = renderHook(() => useStore());

      const mockFiles: FileListItem[] = [
        {
          chunkCount: null,
          chunkingError: null,
          createdAt: new Date(),
          embeddingError: null,
          fileType: 'text/plain',
          finishEmbedding: false,
          id: 'file-1',
          name: 'test.txt',
          size: 100,
          updatedAt: new Date(),
          url: 'http://example.com/test.txt',
        },
      ];

      vi.mocked(lambdaClient.file.getFiles.query).mockResolvedValue(mockFiles);

      const params = { category: 'all' as any };
      renderHook(() => result.current.useFetchFileManage(params));

      await waitFor(() => {
        expect(result.current.fileList).toEqual(mockFiles);
        expect(result.current.queryListParams).toEqual(params);
      });
    });
  });
});
