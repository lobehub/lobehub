import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import type * as SwrModule from '@/libs/swr';
import { mutate } from '@/libs/swr';
import { generationTopicService } from '@/services/generationTopic';
import { useVideoStore, type VideoStore } from '@/store/video';
import { type ImageGenerationTopic } from '@/types/generation';

// The replica driver revalidates through the scoped `mutate`; mock it so the
// imperative refresh assertions below can observe the call.
vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof SwrModule>();
  return { ...actual, mutate: vi.fn() };
});

vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getAllGenerationTopics: vi.fn(),
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
const seedTopics = (topics: ImageGenerationTopic[], extra: Partial<VideoStore> = {}) => {
  useVideoStore.setState({
    generationTopics: topics,
    generationTopicsReplica: createReplicaState(),
    isGenerationTopicsInit: true,
    ...extra,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useVideoStore.setState({
    activeGenerationTopicId: null,
    generationTopics: [],
    generationTopicsReplica: createReplicaState(),
    isGenerationTopicsInit: false,
    loadingGenerationTopicIds: [],
    newGenerationTopicVisibility: 'private',
  });
});

describe('VideoGenerationTopicAction', () => {
  describe('setNewGenerationTopicVisibility', () => {
    it('should default new generation topics to private visibility', () => {
      const { result } = renderHook(() => useVideoStore());

      expect(result.current.newGenerationTopicVisibility).toBe('private');
    });

    it('should update new generation topic visibility', () => {
      const { result } = renderHook(() => useVideoStore());

      act(() => {
        result.current.setNewGenerationTopicVisibility('public');
      });

      expect(result.current.newGenerationTopicVisibility).toBe('public');
    });
  });

  describe('topic navigation', () => {
    it('should clear the editing generation when switching topics', () => {
      const { result } = renderHook(() => useVideoStore());

      act(() => {
        useVideoStore.setState({
          activeGenerationTopicId: 'topic-1',
          editingGenerationId: 'generation-1',
        });
        result.current.switchGenerationTopic('topic-2');
      });

      expect(result.current.activeGenerationTopicId).toBe('topic-2');
      expect(result.current.editingGenerationId).toBeUndefined();
    });

    it('should clear the editing generation when opening a new topic', () => {
      const { result } = renderHook(() => useVideoStore());

      act(() => {
        useVideoStore.setState({
          activeGenerationTopicId: 'topic-1',
          editingGenerationId: 'generation-1',
        });
        result.current.openNewGenerationTopic();
      });

      expect(result.current.activeGenerationTopicId).toBeNull();
      expect(result.current.editingGenerationId).toBeUndefined();
    });
  });

  describe('internal_createGenerationTopic', () => {
    it('should create video topic with private visibility by default', async () => {
      const { result } = renderHook(() => useVideoStore());
      const newTopicId = 'video-topic-private';

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);

      await act(async () => {
        const topicId = await result.current.internal_createGenerationTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(generationTopicService.createTopic).toHaveBeenCalledWith('video', 'private');
      // The replica driver revalidates through the scoped mutate with a matcher.
      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should create video topic with selected public visibility', async () => {
      const { result } = renderHook(() => useVideoStore());
      const newTopicId = 'video-topic-public';

      vi.mocked(generationTopicService.createTopic).mockResolvedValue(newTopicId);

      act(() => {
        result.current.setNewGenerationTopicVisibility('public');
      });

      await act(async () => {
        const topicId = await result.current.internal_createGenerationTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(generationTopicService.createTopic).toHaveBeenCalledWith('video', 'public');
    });
  });

  describe('internal_dispatchGenerationTopic', () => {
    it('should write the reduced topics into the replica view', () => {
      const { result } = renderHook(() => useVideoStore());

      act(() => {
        seedTopics([{ id: 'gt_topic_1', title: 'Topic 1' } as ImageGenerationTopic]);
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

    it('should update a topic in place', () => {
      const { result } = renderHook(() => useVideoStore());
      const existingDate = new Date('2024-01-01T00:00:00.000Z');

      act(() => {
        seedTopics([
          {
            id: 'gt_topic_1',
            title: 'Topic 1',
            createdAt: existingDate,
            updatedAt: existingDate,
          } as ImageGenerationTopic,
        ]);
      });

      act(() => {
        result.current.internal_dispatchGenerationTopic({
          type: 'updateTopic',
          id: 'gt_topic_1',
          value: { title: 'Renamed' },
        });
      });

      expect(result.current.generationTopics[0].title).toBe('Renamed');
      expect(result.current.generationTopics[0].updatedAt.getTime()).toBeGreaterThan(
        existingDate.getTime(),
      );
    });
  });

  describe('refreshGenerationTopics', () => {
    it('should revalidate the topic list replica', async () => {
      const { result } = renderHook(() => useVideoStore());

      await act(async () => {
        await result.current.refreshGenerationTopics();
      });

      expect(mutate).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('internal_updateGenerationTopicCover', () => {
    it('should write the optimistic cover into the replica view and confirm it', async () => {
      const { result } = renderHook(() => useVideoStore());
      const topicId = 'gt_topic_1';
      const coverUrl = 'https://example.com/cover.jpg';

      act(() => {
        seedTopics([{ id: topicId, title: 'Topic 1', coverUrl: '' } as ImageGenerationTopic]);
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      await act(async () => {
        await result.current.updateGenerationTopicCover(topicId, coverUrl);
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        id: topicId,
        type: 'updateTopic',
        value: { coverUrl },
      });
      expect(generationTopicService.updateTopicCover).toHaveBeenCalledWith(topicId, coverUrl);
      // the optimistic cover is written into the replica view
      expect(result.current.generationTopics[0].coverUrl).toBe(coverUrl);
    });
  });

  describe('internal_updateGenerationTopicTitleInSummary', () => {
    it('should write the streamed title into the replica view', () => {
      const { result } = renderHook(() => useVideoStore());
      const topicId = 'gt_topic_1';

      act(() => {
        seedTopics([{ id: topicId, title: 'Original' } as ImageGenerationTopic]);
      });

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchGenerationTopic');

      act(() => {
        result.current.internal_updateGenerationTopicTitleInSummary(topicId, 'Summary Title');
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        id: topicId,
        type: 'updateTopic',
        value: { title: 'Summary Title' },
      });
      expect(result.current.generationTopics[0].title).toBe('Summary Title');
    });
  });
});
