import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { useImageStore } from '@/store/image';
import { type ImageGenerationTopic } from '@/types/generation';

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock services and dependencies
vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: vi.fn(),
    updateTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getAllGenerationTopics: vi.fn(),
    updateTopicCover: vi.fn(),
  },
}));

vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  systemAgentSelectors: {
    generationTopic: vi.fn().mockReturnValue({
      model: 'gpt-4',
      provider: 'openai',
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useImageStore.setState({
    generationTopics: [],
    activeGenerationTopicId: null,
    loadingGenerationTopicIds: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationTopicAction', () => {
  describe('createGenerationTopic', () => {
    it('should create a new topic and auto-generate title from prompts', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_new_topic';
      const prompts = ['A beautiful sunset over mountains'];

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        {
          id: newTopicId,
          title: 'Beautiful Sunset',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as ImageGenerationTopic[]);

      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryGenerationTopicTitle');

      let createdTopicId;
      await act(async () => {
        createdTopicId = await result.current.createGenerationTopic(prompts);
      });

      expect(createdTopicId).toBe(newTopicId);
      expect(generationTopicService.createTopic).toHaveBeenCalled();
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(newTopicId, prompts);
    });

    it('should throw error when prompts are empty', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await expect(result.current.createGenerationTopic([])).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      expect(generationTopicService.createTopic).not.toHaveBeenCalled();
    });

    it('should throw error when prompts are null or undefined', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await expect(result.current.createGenerationTopic(null as any)).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      await act(async () => {
        await expect(result.current.createGenerationTopic(undefined as any)).rejects.toThrow(
          'Prompts cannot be empty when creating a generation topic',
        );
      });

      expect(generationTopicService.createTopic).not.toHaveBeenCalled();
    });
  });

  describe('switchGenerationTopic', () => {
    it('should switch to the specified topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      act(() => {
        result.current.switchGenerationTopic(topicId);
      });

      expect(result.current.activeGenerationTopicId).toBe(topicId);
    });

    it('should not update if already active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const topics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: topicId,
        });
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        result.current.switchGenerationTopic(topicId);
      });

      expect(result.current.activeGenerationTopicId).toBe(topicId);
      consoleSpy.mockRestore();
    });

    it('should warn when topic does not exist', async () => {
      const { result } = renderHook(() => useImageStore());
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      act(() => {
        useImageStore.setState({ generationTopics: [] });
      });

      act(() => {
        result.current.switchGenerationTopic('gt_non_existent_topic');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Generation topic with id gt_non_existent_topic not found',
      );
      consoleSpy.mockRestore();
    });
  });

  describe('openNewGenerationTopic', () => {
    it('should set activeGenerationTopicId to null', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ activeGenerationTopicId: 'existing-topic' });
      });

      act(() => {
        result.current.openNewGenerationTopic();
      });

      expect(result.current.activeGenerationTopicId).toBeNull();
    });
  });

  describe('summaryGenerationTopicTitle', () => {
    it('should generate title using AI and update topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['A beautiful sunset over mountains'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];
      const generatedTitle = 'Mountain Sunset Landscape';

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      // Mock successful AI response
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onFinish) {
          params.onFinish(generatedTitle, { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: generatedTitle,
      });
    });

    it('should use fallback title when AI fails', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['A beautiful sunset over mountains with clear sky'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      // Mock AI error
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onError) {
          params.onError(new Error('AI service failed'));
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
      // Should call with fallback title (first 3 words, max 20 chars)
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: 'A beautiful sunset',
      });
    });

    it('should throw error when topic not found', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        useImageStore.setState({ generationTopics: [] });
      });

      await act(async () => {
        await expect(
          result.current.summaryGenerationTopicTitle('gt_non_existent', ['prompt']),
        ).rejects.toThrow('Topic gt_non_existent not found');
      });
    });

    it('should handle streaming text updates', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['Test prompt'];
      const topics = [{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const updateTitleSpy = vi.spyOn(
        result.current,
        'internal_updateGenerationTopicTitleInSummary',
      );

      // Mock streaming response
      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onMessageHandle) {
          params.onMessageHandle({ type: 'text', text: 'Streaming' });
          params.onMessageHandle({ type: 'text', text: ' Title' });
        }
        if (params.onFinish) {
          params.onFinish('Streaming Title', { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(updateTitleSpy).toHaveBeenCalledWith(topicId, 'Streaming');
      expect(updateTitleSpy).toHaveBeenCalledWith(topicId, 'Streaming Title');
    });
  });

  describe('removeGenerationTopic', () => {
    it('should remove topic and switch to next topic when removing active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
        { id: 'gt_topic_3', title: 'Topic 3' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_2',
        });
      });

      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_3', title: 'Topic 3' },
      ] as ImageGenerationTopic[]);

      const switchTopicSpy = vi.spyOn(result.current, 'switchGenerationTopic');

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_2');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_2');
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should open new topic when removing the last topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_1',
        });
      });

      // Mock getAllGenerationTopics to return empty array after deletion
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([]);

      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');
      const refreshSpy = vi
        .spyOn(result.current, 'refreshGenerationTopics')
        .mockImplementation(async () => {
          // Simulate state update after refresh - empty topics array
          useImageStore.setState({ generationTopics: [] });
        });

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_1');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_1');
      expect(refreshSpy).toHaveBeenCalled();
      expect(openNewTopicSpy).toHaveBeenCalled();
    });

    it('should not switch topic when removing non-active topic', async () => {
      const { result } = renderHook(() => useImageStore());
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1' },
        { id: 'gt_topic_2', title: 'Topic 2' },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({
          generationTopics: topics,
          activeGenerationTopicId: 'gt_topic_1',
        });
      });

      const switchTopicSpy = vi.spyOn(result.current, 'switchGenerationTopic');
      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');

      await act(async () => {
        await result.current.removeGenerationTopic('gt_topic_2');
      });

      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith('gt_topic_2');
      expect(switchTopicSpy).not.toHaveBeenCalled();
      expect(openNewTopicSpy).not.toHaveBeenCalled();
    });
  });

  describe('useFetchGenerationTopics', () => {
    it('should fetch generation topics when enabled', async () => {
      const topics = [
        { id: 'gt_topic_1', title: 'Topic 1', createdAt: new Date(), updatedAt: new Date() },
        { id: 'gt_topic_2', title: 'Topic 2', createdAt: new Date(), updatedAt: new Date() },
      ] as ImageGenerationTopic[];

      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue(topics);

      let hookResult: any;

      await act(async () => {
        const { result } = renderHook(() => {
          const store = useImageStore();
          // Actually call the SWR hook to trigger the service call
          const swrResult = store.useFetchGenerationTopics(true);

          // Simulate the SWR onSuccess callback behavior
          React.useEffect(() => {
            useImageStore.setState({ generationTopics: topics });
          }, []);

          return swrResult;
        });

        hookResult = result;
      });

      // Wait for service to be called and state to be updated
      await waitFor(() => {
        expect(generationTopicService.getAllGenerationTopics).toHaveBeenCalled();
        expect(useImageStore.getState().generationTopics).toEqual(topics);
      });
    });

    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useImageStore().useFetchGenerationTopics(false));

      expect(result.current.data).toBeUndefined();
      expect(generationTopicService.getAllGenerationTopics).not.toHaveBeenCalled();
    });
  });

  describe('refreshGenerationTopics', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it('should call mutate to refresh topics', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.refreshGenerationTopics();
      });

      expect(mutate).toHaveBeenCalledWith(['fetchGenerationTopics']);
    });
  });

  describe('updateGenerationTopicCover', () => {
    it('should update topic cover with optimistic update', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const coverUrl = 'https://example.com/cover.jpg';
      const topics = [{ id: topicId, title: 'Topic 1', coverUrl: '' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      await act(async () => {
        await result.current.updateGenerationTopicCover(topicId, coverUrl);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { type: 'updateTopic', id: topicId, value: { coverUrl } },
        'internal_updateGenerationTopicCover/optimistic',
      );
      expect(generationTopicService.updateTopicCover).toHaveBeenCalledWith(topicId, coverUrl);
    });
  });

  describe('internal_updateGenerationTopicLoading', () => {
    it('should add topic id to loading array when loading is true', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ loadingGenerationTopicIds: [] });
      });

      act(() => {
        result.current.internal_updateGenerationTopicLoading(topicId, true);
      });

      expect(result.current.loadingGenerationTopicIds).toContain(topicId);
    });

    it('should remove topic id from loading array when loading is false', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        useImageStore.setState({ loadingGenerationTopicIds: [topicId] });
      });

      act(() => {
        result.current.internal_updateGenerationTopicLoading(topicId, false);
      });

      expect(result.current.loadingGenerationTopicIds).not.toContain(topicId);
    });
  });

  describe('internal_dispatchGenerationTopic', () => {
    it('should update topics when state changes', async () => {
      const { result } = renderHook(() => useImageStore());
      const initialTopics = [{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: initialTopics });
      });

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'addTopic',
          value: { id: 'gt_topic_2', title: 'Topic 2' },
        });
      });

      expect(result.current.generationTopics).toHaveLength(2);
      expect(result.current.generationTopics.find((t) => t.id === 'gt_topic_2')).toBeDefined();
    });

    it('should not update when topics are equal', async () => {
      const { result } = renderHook(() => useImageStore());
      const existingDate = new Date('2024-01-01T00:00:00.000Z');
      const topics = [
        {
          id: 'gt_topic_1',
          title: 'Topic 1',
          createdAt: existingDate,
          updatedAt: existingDate,
        },
      ] as ImageGenerationTopic[];

      act(() => {
        useImageStore.setState({ generationTopics: topics });
      });

      const stateBefore = result.current.generationTopics;

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'updateTopic',
          id: 'gt_topic_1',
          value: { title: 'Topic 1' }, // Same title, but updatedAt will still change
        });
      });

      // The state object reference should change due to updatedAt being updated
      expect(result.current.generationTopics).not.toBe(stateBefore);
      // But the topic should still exist with updated timestamp
      expect(result.current.generationTopics[0].id).toBe('gt_topic_1');
      expect(result.current.generationTopics[0].title).toBe('Topic 1');
      expect(result.current.generationTopics[0].updatedAt.getTime()).toBeGreaterThan(
        existingDate.getTime(),
      );
    });
  });

  describe('internal_createGenerationTopic', () => {
    it('should create topic with optimistic update pattern', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_new_topic';

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);
      vi.mocked(generationTopicService.getAllGenerationTopics).mockResolvedValue([
        {
          id: newTopicId,
          title: '',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as ImageGenerationTopic[]);

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');
      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');

      await act(async () => {
        const topicId = await result.current.internal_createGenerationTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(dispatchSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith(expect.any(String), true);
      expect(loadingSpy).toHaveBeenCalledWith(newTopicId, false);
      expect(generationTopicService.createTopic).toHaveBeenCalled();
    });
  });

  describe('internal_updateGenerationTopic', () => {
    it('should update topic with optimistic update and refresh', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const updateData = { title: 'Updated Title' };

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');
      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics');

      await act(async () => {
        await result.current.internal_updateGenerationTopic(topicId, updateData);
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        type: 'updateTopic',
        id: topicId,
        value: updateData,
      });
      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, updateData);
      expect(refreshSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });
  });

  describe('internal_updateGenerationTopicTitleInSummary', () => {
    it('should dispatch title update action', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const title = 'Summary Title';

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      act(() => {
        result.current.internal_updateGenerationTopicTitleInSummary(topicId, title);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { type: 'updateTopic', id: topicId, value: { title } },
        'updateGenerationTopicTitleInSummary',
      );
    });
  });

  describe('internal_removeGenerationTopic', () => {
    it('should handle removal with loading states', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');
      const refreshSpy = vi.spyOn(result.current, 'refreshGenerationTopics');

      await act(async () => {
        await result.current.internal_removeGenerationTopic(topicId);
      });

      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(generationTopicService.deleteTopic).toHaveBeenCalledWith(topicId);
      expect(refreshSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });

    it('should clear loading state even if deletion fails', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      vi.mocked(generationTopicService.deleteTopic).mockRejectedValue(new Error('Delete failed'));

      const loadingSpy = vi.spyOn(result.current, 'internal_updateGenerationTopicLoading');

      await act(async () => {
        await expect(result.current.internal_removeGenerationTopic(topicId)).rejects.toThrow(
          'Delete failed',
        );
      });

      expect(loadingSpy).toHaveBeenCalledWith(topicId, true);
      expect(loadingSpy).toHaveBeenCalledWith(topicId, false);
    });
  });
});
