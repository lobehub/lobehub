import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imageService } from '@/services/image';
import { useImageStore } from '@/store/image';

// Mock external dependencies
vi.mock('@/services/image', () => ({
  imageService: {
    createImage: vi.fn().mockResolvedValue({
      success: true,
      data: {
        batch: {
          generationTopicId: 'test-topic-id',
          provider: 'test-provider',
          model: 'test-model',
          prompt: 'test prompt',
          width: 1024,
          height: 1024,
          userId: 'test-user',
          id: 'batch-id',
          accessedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ratio: null,
          config: {},
        },
        generations: [],
      },
    }),
  },
}));

const mockImageService = vi.mocked(imageService);

describe('CreateImageAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to initial state with proper defaults
    const initialState = useImageStore.getState();
    useImageStore.setState({
      ...initialState,
      isCreating: false,
      isCreatingWithNewTopic: false,
      activeGenerationTopicId: 'active-topic-id',
      parameters: { prompt: 'test prompt', width: 1024, height: 1024 },
      provider: 'test-provider',
      model: 'test-model',
      imageNum: 4,
      generationBatchesMap: {
        'active-topic-id': [
          {
            id: 'batch-id',
            provider: 'batch-provider',
            model: 'batch-model',
            config: { prompt: 'batch prompt' },
            generations: [{}, {}, {}, {}], // 4 generations to match expected imageNum
            createdAt: new Date(),
            prompt: 'batch prompt',
          } as any,
        ],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createImage', () => {
    it('should create image with existing topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);

      // Set up store state
      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      await act(async () => {
        await result.current.createImage();
      });

      // Verify state changes
      expect(result.current.isCreating).toBe(false);
      expect(result.current.isCreatingWithNewTopic).toBe(false);

      // Verify service calls
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'active-topic-id',
        provider: 'test-provider',
        model: 'test-model',
        imageNum: 4,
        params: { prompt: 'test prompt', width: 1024, height: 1024 },
      });

      // Verify refresh was called
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();

      // Verify prompt is cleared after successful image creation
      expect(result.current.parameters?.prompt).toBe('');
    });

    it('should create new topic when no active topic exists', async () => {
      const mockCreateGenerationTopic = vi.fn().mockResolvedValue('new-topic-id');
      const mockSwitchGenerationTopic = vi.fn();
      const mockSetTopicBatchLoaded = vi.fn();

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
          createGenerationTopic: mockCreateGenerationTopic,
          switchGenerationTopic: mockSwitchGenerationTopic,
          setTopicBatchLoaded: mockSetTopicBatchLoaded,
        });
      });

      await act(async () => {
        await result.current.createImage();
      });

      // Verify state changes
      expect(result.current.isCreating).toBe(false);
      expect(result.current.isCreatingWithNewTopic).toBe(false);

      // Verify topic creation
      expect(mockCreateGenerationTopic).toHaveBeenCalledWith(['test prompt']);
      expect(mockSetTopicBatchLoaded).toHaveBeenCalledWith('new-topic-id');
      expect(mockSwitchGenerationTopic).toHaveBeenCalledWith('new-topic-id');

      // Verify service call with new topic id
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'new-topic-id',
        provider: 'test-provider',
        model: 'test-model',
        imageNum: 4,
        params: { prompt: 'test prompt', width: 1024, height: 1024 },
      });

      // Verify prompt is cleared after successful image creation
      expect(result.current.parameters?.prompt).toBe('');
    });

    it('should throw error when parameters is not initialized', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: undefined, // Set parameters to undefined
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('parameters is not initialized');
    });

    it('should throw error when prompt is empty', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          parameters: {
            prompt: '', // Empty prompt
            width: 1024,
            height: 1024,
          },
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('prompt is empty');
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockRefreshGenerationBatches = vi.fn();
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('Service error');

      // The service should have been called before the error
      expect(mockImageService.createImage).toHaveBeenCalled();

      // Verify prompt is NOT cleared when error occurs
      expect(result.current.parameters?.prompt).toBe('test prompt');
    });

    it('should handle service error with new topic', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockCreateGenerationTopic = vi.fn().mockResolvedValue('new-topic-id');
      const mockSwitchGenerationTopic = vi.fn();
      const mockSetTopicBatchLoaded = vi.fn();

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
          createGenerationTopic: mockCreateGenerationTopic,
          switchGenerationTopic: mockSwitchGenerationTopic,
          setTopicBatchLoaded: mockSetTopicBatchLoaded,
        });
      });

      await expect(
        act(async () => {
          await result.current.createImage();
        }),
      ).rejects.toThrow('Service error');

      // Verify topic was created before the error
      expect(mockCreateGenerationTopic).toHaveBeenCalled();
      expect(mockSwitchGenerationTopic).toHaveBeenCalled();

      // Verify prompt is NOT cleared when error occurs
      expect(result.current.parameters?.prompt).toBe('test prompt');
    });

    it('should clear prompt input after successful image creation', async () => {
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useImageStore());

      // Set initial prompt value
      act(() => {
        useImageStore.setState({
          parameters: { prompt: 'detailed landscape artwork', width: 1024, height: 1024 },
          refreshGenerationBatches: mockRefreshGenerationBatches,
        });
      });

      // Verify initial prompt is set
      expect(result.current.parameters?.prompt).toBe('detailed landscape artwork');

      // Create image
      await act(async () => {
        await result.current.createImage();
      });

      // Verify prompt is cleared
      expect(result.current.parameters?.prompt).toBe('');

      // Verify other parameters remain unchanged
      expect(result.current.parameters?.width).toBe(1024);
      expect(result.current.parameters?.height).toBe(1024);
    });
  });

  describe('recreateImage', () => {
    it('should recreate image successfully', async () => {
      const mockRefreshGenerationBatches = vi.fn().mockResolvedValue(undefined);
      const mockRemoveGenerationBatch = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      // Get batch to verify imageNum uses batch.generations.length
      const batch = result.current.generationBatchesMap['active-topic-id']?.[0];
      const expectedImageNum = batch?.generations.length ?? 0;

      await act(async () => {
        await result.current.recreateImage('batch-id');
      });

      // Verify state changes
      expect(result.current.isCreating).toBe(false);

      // Verify batch removal
      expect(mockRemoveGenerationBatch).toHaveBeenCalledWith('batch-id', 'active-topic-id');

      // Verify service call uses batch.generations.length for imageNum
      expect(mockImageService.createImage).toHaveBeenCalledWith({
        generationTopicId: 'active-topic-id',
        provider: 'batch-provider',
        model: 'batch-model',
        imageNum: expectedImageNum,
        params: { prompt: 'batch prompt' },
      });

      // Verify refresh was called
      expect(mockRefreshGenerationBatches).toHaveBeenCalled();
    });

    it('should throw error when no active topic', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          activeGenerationTopicId: '', // No active topic
        });
      });

      await expect(
        act(async () => {
          await result.current.recreateImage('batch-id');
        }),
      ).rejects.toThrow('No active generation topic');
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      mockImageService.createImage.mockRejectedValueOnce(error);

      const mockRefreshGenerationBatches = vi.fn();
      const mockRemoveGenerationBatch = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          refreshGenerationBatches: mockRefreshGenerationBatches,
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      await expect(
        act(async () => {
          await result.current.recreateImage('batch-id');
        }),
      ).rejects.toThrow('Service error');

      // Verify batch was removed before the error
      expect(mockRemoveGenerationBatch).toHaveBeenCalledWith('batch-id', 'active-topic-id');
    });

    it('should handle batch removal error', async () => {
      const error = new Error('Removal error');
      const mockRemoveGenerationBatch = vi.fn().mockRejectedValueOnce(error);

      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({
          removeGenerationBatch: mockRemoveGenerationBatch,
        });
      });

      await expect(
        act(async () => {
          await result.current.recreateImage('batch-id');
        }),
      ).rejects.toThrow('Removal error');

      // Verify image service was not called after removal error
      expect(mockImageService.createImage).not.toHaveBeenCalled();
    });
  });
});
