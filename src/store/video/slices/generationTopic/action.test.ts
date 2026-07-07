import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { generationTopicService } from '@/services/generationTopic';
import { useVideoStore } from '@/store/video';

vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
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
  userGeneralSettingsSelectors: {
    currentResponseLanguage: vi.fn(() => 'en-US'),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useVideoStore.setState({
    activeGenerationTopicId: null,
    generationTopics: [],
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
      expect(mutate).toHaveBeenCalledWith(['video:generationTopics']);
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
});
