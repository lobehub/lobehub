import { RequestTrigger } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { generationTopicService } from '@/services/generationTopic';
import { type ImageStore, useImageStore } from '@/store/image';
import { type ImageGenerationTopic } from '@/types/generation';

// The replica driver revalidates through the scoped `mutate`; mock it so the
// imperative refresh assertions below can observe the call.
vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return { ...actual, mutate: vi.fn() };
});

// Mock services and dependencies
vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getAllGenerationTopics: vi.fn(),
    setTopicVisibility: vi.fn(),
    updateTopic: vi.fn(),
    updateTopicCover: vi.fn(),
  },
}));

vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

/** Seed the topic-list replica view (init true, so `internal_dispatch*` reduces over it). */
const seedTopics = (topics: ImageGenerationTopic[], extra: Partial<ImageStore> = {}) => {
  useImageStore.setState({
    generationTopics: topics,
    generationTopicsReplica: createReplicaState(),
    isGenerationTopicsInit: true,
    ...extra,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useImageStore.setState({
    generationTopics: [],
    generationTopicsReplica: createReplicaState(),
    isGenerationTopicsInit: false,
    activeGenerationTopicId: null,
    loadingGenerationTopicIds: [],
    newGenerationTopicVisibility: 'private',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GenerationTopicAction', () => {
  describe('setNewGenerationTopicVisibility', () => {
    it('should default new generation topics to private visibility', () => {
      const { result } = renderHook(() => useImageStore());

      expect(result.current.newGenerationTopicVisibility).toBe('private');
    });

    it('should update new generation topic visibility', () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        result.current.setNewGenerationTopicVisibility('public');
      });

      expect(result.current.newGenerationTopicVisibility).toBe('public');
    });
  });

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
      expect(generationTopicService.createTopic).toHaveBeenCalledWith('image', 'private');
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
        seedTopics(topics);
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
        seedTopics(topics, { activeGenerationTopicId: topicId });
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
        seedTopics([]);
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
      const generatedTitle = 'Mountain Sunset Landscape';

      act(() => {
        seedTopics([{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[]);
      });

      vi.mocked(chatService.fetchPresetTaskResult).mockImplementation((params) => {
        if (params.onFinish) {
          params.onFinish(generatedTitle, { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryGenerationTopicTitle(topicId, prompts);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: RequestTrigger.GenerationTopicTitle }),
      );
      expect(generationTopicService.updateTopic).toHaveBeenCalledWith(topicId, {
        title: generatedTitle,
      });
    });

    it('should use fallback title when AI fails', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const prompts = ['A beautiful sunset over mountains with clear sky'];

      act(() => {
        seedTopics([{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[]);
      });

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
        seedTopics([]);
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

      act(() => {
        seedTopics([{ id: topicId, title: 'Original Title' }] as ImageGenerationTopic[]);
      });

      const updateTitleSpy = vi.spyOn(
        result.current,
        'internal_updateGenerationTopicTitleInSummary',
      );

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

      act(() => {
        seedTopics(
          [
            { id: 'gt_topic_1', title: 'Topic 1' },
            { id: 'gt_topic_2', title: 'Topic 2' },
            { id: 'gt_topic_3', title: 'Topic 3' },
          ] as ImageGenerationTopic[],
          { activeGenerationTopicId: 'gt_topic_2' },
        );
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

      act(() => {
        seedTopics([{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[], {
          activeGenerationTopicId: 'gt_topic_1',
        });
      });

      const openNewTopicSpy = vi.spyOn(result.current, 'openNewGenerationTopic');
      const refreshSpy = vi
        .spyOn(result.current, 'refreshGenerationTopics')
        .mockImplementation(async () => {
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

      act(() => {
        seedTopics(
          [
            { id: 'gt_topic_1', title: 'Topic 1' },
            { id: 'gt_topic_2', title: 'Topic 2' },
          ] as ImageGenerationTopic[],
          { activeGenerationTopicId: 'gt_topic_1' },
        );
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
    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useImageStore().useFetchGenerationTopics(false));

      expect(result.current.data).toBeUndefined();
      expect(generationTopicService.getAllGenerationTopics).not.toHaveBeenCalled();
    });
  });

  describe('refreshGenerationTopics', () => {
    it('should revalidate the topic list replica', async () => {
      const { result } = renderHook(() => useImageStore());

      await act(async () => {
        await result.current.refreshGenerationTopics();
      });

      // The replica driver revalidates through the scoped mutate with a matcher.
      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('updateGenerationTopicCover', () => {
    it('should update topic cover with optimistic update', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const coverUrl = 'https://example.com/cover.jpg';

      act(() => {
        seedTopics([{ id: topicId, title: 'Topic 1', coverUrl: '' }] as ImageGenerationTopic[]);
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      await act(async () => {
        await result.current.updateGenerationTopicCover(topicId, coverUrl);
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        type: 'updateTopic',
        id: topicId,
        value: { coverUrl },
      });
      expect(generationTopicService.updateTopicCover).toHaveBeenCalledWith(topicId, coverUrl);
      // the optimistic cover is written into the replica view
      expect(result.current.generationTopics[0].coverUrl).toBe(coverUrl);
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
    it('should write the reduced topics into the replica view', async () => {
      const { result } = renderHook(() => useImageStore());

      act(() => {
        seedTopics([{ id: 'gt_topic_1', title: 'Topic 1' }] as ImageGenerationTopic[]);
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

    it('should update a topic in place', async () => {
      const { result } = renderHook(() => useImageStore());
      const existingDate = new Date('2024-01-01T00:00:00.000Z');

      act(() => {
        seedTopics([
          {
            id: 'gt_topic_1',
            title: 'Topic 1',
            createdAt: existingDate,
            updatedAt: existingDate,
          },
        ] as ImageGenerationTopic[]);
      });

      const stateBefore = result.current.generationTopics;

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'updateTopic',
          id: 'gt_topic_1',
          value: { title: 'Renamed' },
        });
      });

      expect(result.current.generationTopics).not.toBe(stateBefore);
      expect(result.current.generationTopics[0].title).toBe('Renamed');
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
      expect(generationTopicService.createTopic).toHaveBeenCalledWith('image', 'private');
    });

    it('should create topic with selected public visibility', async () => {
      const { result } = renderHook(() => useImageStore());
      const newTopicId = 'gt_public_topic';

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);

      act(() => {
        result.current.setNewGenerationTopicVisibility('public');
      });

      await act(async () => {
        const topicId = await result.current.internal_createGenerationTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(generationTopicService.createTopic).toHaveBeenCalledWith('image', 'public');
    });
  });

  describe('internal_updateGenerationTopic', () => {
    it('should update topic with optimistic update and refresh', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';
      const updateData = { title: 'Updated Title' };

      act(() => {
        seedTopics([{ id: topicId, title: 'Topic 1' }] as ImageGenerationTopic[]);
      });

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
    it('should write the streamed title into the replica view', async () => {
      const { result } = renderHook(() => useImageStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedTopics([{ id: topicId, title: 'Original' }] as ImageGenerationTopic[]);
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      act(() => {
        result.current.internal_updateGenerationTopicTitleInSummary(topicId, 'Summary Title');
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        type: 'updateTopic',
        id: topicId,
        value: { title: 'Summary Title' },
      });
      expect(result.current.generationTopics[0].title).toBe('Summary Title');
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
