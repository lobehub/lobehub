import { describe, expect, it } from 'vitest';

import { type ImageStore } from '@/store/image';
import { initialState } from '@/store/image/initialState';
import { type ImageGenerationTopic } from '@/types/generation';
import { merge } from '@/utils/merge';

import { generationTopicSelectors } from './selectors';

const initialStore = initialState as ImageStore;

const mockGenerationTopics: ImageGenerationTopic[] = [
  {
    id: 'gt_aBc123xYz456',
    title: 'Generation Topic 1',
    coverUrl: 'https://example.com/cover1.jpg',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  },
  {
    id: 'gt_dEf789uVw012',
    title: 'Generation Topic 2',
    coverUrl: null,
    createdAt: new Date('2023-01-02'),
    updatedAt: new Date('2023-01-02'),
  },
];

describe('generationTopicSelectors', () => {
  describe('activeGenerationTopicId', () => {
    it('should return null when no active topic is set', () => {
      const activeId = generationTopicSelectors.activeGenerationTopicId(initialStore);
      expect(activeId).toBeNull();
    });

    it('should return the active generation topic id', () => {
      const state = merge(initialStore, { activeGenerationTopicId: 'gt_aBc123xYz456' });
      const activeId = generationTopicSelectors.activeGenerationTopicId(state);
      expect(activeId).toBe('gt_aBc123xYz456');
    });
  });

  describe('generationTopics', () => {
    it('should return empty array when no topics exist', () => {
      const topics = generationTopicSelectors.generationTopics(initialStore);
      expect(topics).toEqual([]);
    });

    it('should return all generation topics from the store', () => {
      const state = merge(initialStore, { generationTopics: mockGenerationTopics });
      const topics = generationTopicSelectors.generationTopics(state);
      expect(topics).toEqual(mockGenerationTopics);
    });
  });

  describe('getGenerationTopicById', () => {
    it('should return undefined when topic is not found', () => {
      const state = merge(initialStore, { generationTopics: mockGenerationTopics });
      const topic = generationTopicSelectors.getGenerationTopicById('nonexistent')(state);
      expect(topic).toBeUndefined();
    });

    it('should return the topic with the given id', () => {
      const state = merge(initialStore, { generationTopics: mockGenerationTopics });
      const topic = generationTopicSelectors.getGenerationTopicById('gt_aBc123xYz456')(state);
      expect(topic).toEqual(mockGenerationTopics[0]);
    });

    it('should return the correct topic when multiple topics exist', () => {
      const state = merge(initialStore, { generationTopics: mockGenerationTopics });
      const topic = generationTopicSelectors.getGenerationTopicById('gt_dEf789uVw012')(state);
      expect(topic).toEqual(mockGenerationTopics[1]);
    });
  });

  describe('isLoadingGenerationTopic', () => {
    it('should return false when no topics are loading', () => {
      const isLoading =
        generationTopicSelectors.isLoadingGenerationTopic('gt_aBc123xYz456')(initialStore);
      expect(isLoading).toBe(false);
    });

    it('should return false when topic is not in loading list', () => {
      const state = merge(initialStore, { loadingGenerationTopicIds: ['gt_dEf789uVw012'] });
      const isLoading = generationTopicSelectors.isLoadingGenerationTopic('gt_aBc123xYz456')(state);
      expect(isLoading).toBe(false);
    });

    it('should return true when topic is in loading list', () => {
      const state = merge(initialStore, {
        loadingGenerationTopicIds: ['gt_aBc123xYz456', 'gt_dEf789uVw012'],
      });
      const isLoading = generationTopicSelectors.isLoadingGenerationTopic('gt_aBc123xYz456')(state);
      expect(isLoading).toBe(true);
    });

    it('should return true when topic is the only one in loading list', () => {
      const state = merge(initialStore, { loadingGenerationTopicIds: ['gt_aBc123xYz456'] });
      const isLoading = generationTopicSelectors.isLoadingGenerationTopic('gt_aBc123xYz456')(state);
      expect(isLoading).toBe(true);
    });
  });
});
