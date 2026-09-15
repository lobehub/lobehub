import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ragService } from '@/services/rag';

import { useFileStore as useStore } from '../../store';

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState(
    {
      chunkDetailId: null,
      highlightChunkIds: [],
      isSimilaritySearch: false,
      isSimilaritySearching: false,
      similaritySearchChunks: [],
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileChunkActions', () => {
  describe('closeChunkDrawer', () => {
    it('should reset chunk drawer state', () => {
      const { result } = renderHook(() => useStore());

      // Setup initial state
      act(() => {
        useStore.setState({
          chunkDetailId: 'chunk-123',
          highlightChunkIds: ['chunk-1', 'chunk-2'],
          isSimilaritySearch: true,
          similaritySearchChunks: [
            {
              fileId: 'file-1',
              fileName: 'test.txt',
              id: 'chunk-1',
              index: 0,
              metadata: null,
              similarity: 0.95,
              text: 'test content',
              type: 'text',
            },
          ] as any,
        });
      });

      act(() => {
        result.current.closeChunkDrawer();
      });

      expect(result.current.chunkDetailId).toBeNull();
      expect(result.current.isSimilaritySearch).toBe(false);
      expect(result.current.similaritySearchChunks).toEqual([]);
    });

    it('should work when state is already clean', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.closeChunkDrawer();
      });

      expect(result.current.chunkDetailId).toBeNull();
      expect(result.current.isSimilaritySearch).toBe(false);
      expect(result.current.similaritySearchChunks).toEqual([]);
    });
  });

  describe('highlightChunks', () => {
    it('should set highlight chunk ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.highlightChunks(['chunk-1', 'chunk-2', 'chunk-3']);
      });

      expect(result.current.highlightChunkIds).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    });

    it('should replace existing highlight chunk ids', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ highlightChunkIds: ['old-chunk-1', 'old-chunk-2'] });
      });

      act(() => {
        result.current.highlightChunks(['new-chunk-1', 'new-chunk-2']);
      });

      expect(result.current.highlightChunkIds).toEqual(['new-chunk-1', 'new-chunk-2']);
    });

    it('should handle empty array', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ highlightChunkIds: ['chunk-1', 'chunk-2'] });
      });

      act(() => {
        result.current.highlightChunks([]);
      });

      expect(result.current.highlightChunkIds).toEqual([]);
    });

    it('should handle single id', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.highlightChunks(['single-chunk']);
      });

      expect(result.current.highlightChunkIds).toEqual(['single-chunk']);
    });
  });

  describe('openChunkDrawer', () => {
    it('should set chunk detail id', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        result.current.openChunkDrawer('chunk-123');
      });

      expect(result.current.chunkDetailId).toBe('chunk-123');
    });

    it('should replace existing chunk detail id', () => {
      const { result } = renderHook(() => useStore());

      act(() => {
        useStore.setState({ chunkDetailId: 'old-chunk-id' });
      });

      act(() => {
        result.current.openChunkDrawer('new-chunk-id');
      });

      expect(result.current.chunkDetailId).toBe('new-chunk-id');
    });

    it('should preserve other state when opening drawer', () => {
      const { result } = renderHook(() => useStore());

      const mockChunks = [
        {
          fileId: 'file-1',
          fileName: 'test.txt',
          id: 'chunk-1',
          index: 0,
          metadata: null,
          similarity: 0.95,
          text: 'test content',
          type: 'text',
        },
      ] as any;

      act(() => {
        useStore.setState({
          highlightChunkIds: ['chunk-1'],
          isSimilaritySearch: true,
          similaritySearchChunks: mockChunks,
        });
      });

      act(() => {
        result.current.openChunkDrawer('chunk-123');
      });

      expect(result.current.chunkDetailId).toBe('chunk-123');
      expect(result.current.highlightChunkIds).toEqual(['chunk-1']);
      expect(result.current.isSimilaritySearch).toBe(true);
      expect(result.current.similaritySearchChunks).toEqual(mockChunks);
    });
  });

  describe('semanticSearch', () => {
    it('should perform semantic search and update state', async () => {
      const { result } = renderHook(() => useStore());

      const mockChunks = [
        {
          fileId: 'file-1',
          fileName: 'document1.pdf',
          id: 'chunk-1',
          index: 0,
          metadata: null,
          pageNumber: 1,
          similarity: 0.95,
          text: 'This is relevant content',
          type: 'text',
        },
        {
          fileId: 'file-2',
          fileName: 'document2.pdf',
          id: 'chunk-2',
          index: 1,
          metadata: null,
          pageNumber: 2,
          similarity: 0.89,
          text: 'Another relevant chunk',
          type: 'text',
        },
      ] as any;

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockResolvedValue(mockChunks);

      await act(async () => {
        await result.current.semanticSearch('test query', 'file-1');
      });

      expect(searchSpy).toHaveBeenCalledWith('test query', ['file-1']);
      expect(result.current.similaritySearchChunks).toEqual(mockChunks);
      expect(result.current.isSimilaritySearching).toBe(false);
    });

    it('should set loading state during search', async () => {
      const { result } = renderHook(() => useStore());

      let loadingStateDuringSearch = false;

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockImplementation(async () => {
        // Capture loading state during async operation
        loadingStateDuringSearch = useStore.getState().isSimilaritySearching || false;
        return [];
      });

      await act(async () => {
        await result.current.semanticSearch('test query', 'file-1');
      });

      expect(searchSpy).toHaveBeenCalled();
      expect(loadingStateDuringSearch).toBe(true);
      expect(result.current.isSimilaritySearching).toBe(false);
    });

    it('should handle empty search results', async () => {
      const { result } = renderHook(() => useStore());

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockResolvedValue([]);

      await act(async () => {
        await result.current.semanticSearch('no results query', 'file-1');
      });

      expect(searchSpy).toHaveBeenCalledWith('no results query', ['file-1']);
      expect(result.current.similaritySearchChunks).toEqual([]);
      expect(result.current.isSimilaritySearching).toBe(false);
    });

    it('should handle search with multiple file ids', async () => {
      const { result } = renderHook(() => useStore());

      const mockChunks = [
        {
          fileId: 'file-1',
          fileName: 'doc1.pdf',
          id: 'chunk-1',
          index: 0,
          metadata: null,
          similarity: 0.92,
          text: 'Content from file 1',
          type: 'text',
        },
      ] as any;

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockResolvedValue(mockChunks);

      await act(async () => {
        await result.current.semanticSearch('test query', 'file-1,file-2');
      });

      // Note: The action takes a single fileId string, but the service expects an array
      expect(searchSpy).toHaveBeenCalledWith('test query', ['file-1,file-2']);
      expect(result.current.similaritySearchChunks).toEqual(mockChunks);
    });

    it('should throw error when search fails', async () => {
      const { result } = renderHook(() => useStore());

      const searchSpy = vi
        .spyOn(ragService, 'semanticSearch')
        .mockRejectedValue(new Error('Search failed'));

      await act(async () => {
        await expect(result.current.semanticSearch('test query', 'file-1')).rejects.toThrow(
          'Search failed',
        );
      });

      expect(searchSpy).toHaveBeenCalledWith('test query', ['file-1']);
      // Note: Loading state remains true since there's no error handling
      expect(result.current.isSimilaritySearching).toBe(true);
    });

    it('should replace previous search results', async () => {
      const { result } = renderHook(() => useStore());

      const oldChunks = [
        {
          fileId: 'file-1',
          fileName: 'old.pdf',
          id: 'old-chunk',
          index: 0,
          metadata: null,
          similarity: 0.8,
          text: 'Old content',
          type: 'text',
        },
      ] as any;

      const newChunks = [
        {
          fileId: 'file-2',
          fileName: 'new.pdf',
          id: 'new-chunk',
          index: 0,
          metadata: null,
          similarity: 0.95,
          text: 'New content',
          type: 'text',
        },
      ] as any;

      act(() => {
        useStore.setState({ similaritySearchChunks: oldChunks });
      });

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockResolvedValue(newChunks);

      await act(async () => {
        await result.current.semanticSearch('new query', 'file-2');
      });

      expect(searchSpy).toHaveBeenCalledWith('new query', ['file-2']);
      expect(result.current.similaritySearchChunks).toEqual(newChunks);
    });

    it('should handle search with complex metadata', async () => {
      const { result } = renderHook(() => useStore());

      const mockChunks = [
        {
          fileId: 'file-1',
          fileName: 'complex.pdf',
          id: 'chunk-1',
          index: 0,
          metadata: {
            coordinates: {
              layout_height: 100,
              layout_width: 200,
              points: [
                [0, 0],
                [200, 100],
              ],
              system: 'test',
            },
            languages: ['en', 'zh'],
            pageNumber: 5,
            text_as_html: '<p>Test content</p>',
          },
          pageNumber: 5,
          similarity: 0.97,
          text: 'Complex content with metadata',
          type: 'text',
        },
      ] as any;

      const searchSpy = vi.spyOn(ragService, 'semanticSearch').mockResolvedValue(mockChunks);

      await act(async () => {
        await result.current.semanticSearch('complex query', 'file-1');
      });

      expect(searchSpy).toHaveBeenCalledWith('complex query', ['file-1']);
      expect(result.current.similaritySearchChunks).toEqual(mockChunks);
    });

    it('should handle concurrent search requests', async () => {
      const { result } = renderHook(() => useStore());

      const firstChunks = [
        {
          fileId: 'file-1',
          fileName: 'first.pdf',
          id: 'chunk-1',
          index: 0,
          metadata: null,
          similarity: 0.9,
          text: 'First search result',
          type: 'text',
        },
      ] as any;

      const secondChunks = [
        {
          fileId: 'file-2',
          fileName: 'second.pdf',
          id: 'chunk-2',
          index: 0,
          metadata: null,
          similarity: 0.85,
          text: 'Second search result',
          type: 'text',
        },
      ] as any;

      const searchSpy = vi
        .spyOn(ragService, 'semanticSearch')
        .mockResolvedValueOnce(firstChunks)
        .mockResolvedValueOnce(secondChunks);

      await act(async () => {
        await Promise.all([
          result.current.semanticSearch('first query', 'file-1'),
          result.current.semanticSearch('second query', 'file-2'),
        ]);
      });

      expect(searchSpy).toHaveBeenCalledTimes(2);
      // The last call should win
      expect(result.current.similaritySearchChunks).toEqual(secondChunks);
      expect(result.current.isSimilaritySearching).toBe(false);
    });

    it('should preserve other state on search error', async () => {
      const { result } = renderHook(() => useStore());

      const existingChunks = [
        {
          fileId: 'file-1',
          fileName: 'existing.pdf',
          id: 'existing-chunk',
          index: 0,
          metadata: null,
          similarity: 0.9,
          text: 'Existing content',
          type: 'text',
        },
      ] as any;

      act(() => {
        useStore.setState({
          chunkDetailId: 'chunk-123',
          highlightChunkIds: ['chunk-1'],
          similaritySearchChunks: existingChunks,
        });
      });

      const searchSpy = vi
        .spyOn(ragService, 'semanticSearch')
        .mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await expect(result.current.semanticSearch('failing query', 'file-1')).rejects.toThrow(
          'Network error',
        );
      });

      expect(searchSpy).toHaveBeenCalled();
      // Other state should be preserved (except loading state which remains true)
      expect(result.current.chunkDetailId).toBe('chunk-123');
      expect(result.current.highlightChunkIds).toEqual(['chunk-1']);
      expect(result.current.similaritySearchChunks).toEqual(existingChunks);
      // Loading state remains true due to no error handling in the action
      expect(result.current.isSimilaritySearching).toBe(true);
    });
  });
});
