import { describe, expect, it } from 'vitest';

import { type BriefStore } from '@/store/brief/store';
import { type BriefItem } from '@/store/brief/types';

import { initialBriefListState } from './initialState';
import { BRIEF_LIST_KEY } from './projection';
import { briefListSelectors } from './selectors';

const createState = (overrides: Partial<BriefStore> = {}) =>
  ({
    ...initialBriefListState,
    ...overrides,
  }) as BriefStore;

const feed = (briefs: BriefItem[]) => ({ [BRIEF_LIST_KEY]: briefs });

describe('briefListSelectors', () => {
  describe('briefs', () => {
    it('should return empty array by default', () => {
      expect(briefListSelectors.briefs(createState())).toEqual([]);
    });

    it('should return the loaded feed', () => {
      const briefs = [{ id: 'brief-1' }] as unknown as BriefItem[];
      const state = createState({ briefListMap: feed(briefs) });
      expect(briefListSelectors.briefs(state)).toBe(briefs);
    });

    // An identity scope with no value yet must not churn `shallow`-compared
    // subscribers (and must not look like an empty feed).
    it('should keep a stable identity for an unloaded feed', () => {
      const state = createState();
      expect(briefListSelectors.briefs(state)).toBe(briefListSelectors.briefs(state));
    });
  });

  describe('hasBriefs', () => {
    it('should return false when empty', () => {
      expect(briefListSelectors.hasBriefs(createState())).toBe(false);
    });

    it('should return true when has briefs', () => {
      const state = createState({ briefListMap: feed([{ id: 'brief-1' } as BriefItem]) });
      expect(briefListSelectors.hasBriefs(state)).toBe(true);
    });
  });

  describe('isBriefsInit', () => {
    it('should return false while the feed has no value for the active scope', () => {
      expect(briefListSelectors.isBriefsInit(createState())).toBe(false);
    });

    it('should report loaded once the feed has a value, even an empty one', () => {
      expect(briefListSelectors.isBriefsInit(createState({ briefListMap: feed([]) }))).toBe(true);
    });
  });
});
