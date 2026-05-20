import { describe, expect, it } from 'vitest';

import { type BriefStore } from '@/store/brief/store';

import { initialBriefListState } from './initialState';
import { briefListSelectors } from './selectors';

const createState = (overrides: Partial<BriefStore> = {}) =>
  ({
    ...initialBriefListState,
    ...overrides,
  }) as BriefStore;

describe('briefListSelectors', () => {
  describe('briefs', () => {
    it('should return empty array by default', () => {
      const state = createState();
      expect(briefListSelectors.briefs(state)).toEqual([]);
    });

    it('should return briefs from state', () => {
      const briefs = [{ id: 'brief-1', title: 'Test' }] as any;
      const state = createState({ briefs });
      expect(briefListSelectors.briefs(state)).toBe(briefs);
    });
  });

  describe('hasBriefs', () => {
    it('should return false when empty', () => {
      const state = createState();
      expect(briefListSelectors.hasBriefs(state)).toBe(false);
    });

    it('should return true when has briefs', () => {
      const state = createState({ briefs: [{ id: 'brief-1' }] as any });
      expect(briefListSelectors.hasBriefs(state)).toBe(true);
    });
  });

  describe('isBriefsInit', () => {
    it('should return false by default', () => {
      const state = createState();
      expect(briefListSelectors.isBriefsInit(state)).toBe(false);
    });

    it('should return true when initialized', () => {
      const state = createState({ isBriefsInit: true });
      expect(briefListSelectors.isBriefsInit(state)).toBe(true);
    });
  });
});
