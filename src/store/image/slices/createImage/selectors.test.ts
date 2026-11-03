import { describe, expect, it } from 'vitest';

import { merge } from '@/utils/merge';

import { type ImageStore } from '../../store';
import { initialCreateImageState } from './initialState';
import { createImageSelectors } from './selectors';

// 创建一个最小的 ImageStore 模拟对象
const createMockImageStore = (overrides?: Partial<ImageStore>): ImageStore => {
  return merge(
    {
      ...initialCreateImageState,
      // 其他必要的初始状态
    } as ImageStore,
    overrides || {},
  );
};

describe('createImageSelectors', () => {
  describe('isCreating', () => {
    it('should return false from initial state', () => {
      const state = createMockImageStore();

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(false);
    });

    it('should return true when isCreating is true', () => {
      const state = createMockImageStore({ isCreating: true });

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(true);
    });

    it('should return false when isCreating is explicitly set to false', () => {
      const state = createMockImageStore({ isCreating: false });

      const result = createImageSelectors.isCreating(state);

      expect(result).toBe(false);
    });
  });

  describe('isCreatingWithNewTopic', () => {
    it('should return false from initial state', () => {
      const state = createMockImageStore();

      const result = createImageSelectors.isCreatingWithNewTopic(state);

      expect(result).toBe(false);
    });

    it('should return true when isCreatingWithNewTopic is true', () => {
      const state = createMockImageStore({ isCreatingWithNewTopic: true });

      const result = createImageSelectors.isCreatingWithNewTopic(state);

      expect(result).toBe(true);
    });

    it('should return false when isCreatingWithNewTopic is explicitly set to false', () => {
      const state = createMockImageStore({ isCreatingWithNewTopic: false });

      const result = createImageSelectors.isCreatingWithNewTopic(state);

      expect(result).toBe(false);
    });
  });

  describe('combined states', () => {
    it('should handle both states being true', () => {
      const state = createMockImageStore({
        isCreating: true,
        isCreatingWithNewTopic: true,
      });

      expect(createImageSelectors.isCreating(state)).toBe(true);
      expect(createImageSelectors.isCreatingWithNewTopic(state)).toBe(true);
    });

    it('should handle mixed states', () => {
      const state = createMockImageStore({
        isCreating: true,
        isCreatingWithNewTopic: false,
      });

      expect(createImageSelectors.isCreating(state)).toBe(true);
      expect(createImageSelectors.isCreatingWithNewTopic(state)).toBe(false);
    });

    it('should handle opposite mixed states', () => {
      const state = createMockImageStore({
        isCreating: false,
        isCreatingWithNewTopic: true,
      });

      expect(createImageSelectors.isCreating(state)).toBe(false);
      expect(createImageSelectors.isCreatingWithNewTopic(state)).toBe(true);
    });

    it('should handle both states being false', () => {
      const state = createMockImageStore({
        isCreating: false,
        isCreatingWithNewTopic: false,
      });

      expect(createImageSelectors.isCreating(state)).toBe(false);
      expect(createImageSelectors.isCreatingWithNewTopic(state)).toBe(false);
    });
  });
});
