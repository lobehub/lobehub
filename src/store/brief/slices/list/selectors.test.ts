import { describe, expect, it } from 'vitest';

import { type BriefStore } from '@/store/brief/store';

import { initialBriefListState } from './initialState';
import { briefListSelectors } from './selectors';

const SCOPE = 'user-1:workspace-1';
const OTHER_SCOPE = 'user-1:workspace-2';

const createState = (overrides: Partial<BriefStore> = {}) =>
  ({
    ...initialBriefListState,
    ...overrides,
  }) as BriefStore;

describe('briefListSelectors', () => {
  describe('briefs', () => {
    it('should return empty array by default', () => {
      const state = createState();
      expect(briefListSelectors.briefs(SCOPE)(state)).toEqual([]);
    });

    it('should return briefs fetched for the active scope', () => {
      const briefs = [{ id: 'brief-1', title: 'Test' }] as any;
      const state = createState({ briefs, briefsScope: SCOPE });
      expect(briefListSelectors.briefs(SCOPE)(state)).toBe(briefs);
    });

    // The reported bug: after a workspace switch the previous scope's briefs
    // stayed on screen, and every action on them 404'd silently.
    it('should hide briefs fetched for another scope', () => {
      const briefs = [{ id: 'brief-1', title: 'Test' }] as any;
      const state = createState({ briefs, briefsScope: OTHER_SCOPE, isBriefsInit: true });
      expect(briefListSelectors.briefs(SCOPE)(state)).toEqual([]);
    });

    it('should keep a stable identity across scope misses so subscribers do not churn', () => {
      const state = createState({ briefs: [{ id: 'brief-1' }] as any, briefsScope: OTHER_SCOPE });
      expect(briefListSelectors.briefs(SCOPE)(state)).toBe(briefListSelectors.briefs(SCOPE)(state));
    });
  });

  describe('hasBriefs', () => {
    it('should return false when empty', () => {
      const state = createState();
      expect(briefListSelectors.hasBriefs(SCOPE)(state)).toBe(false);
    });

    it('should return true when has briefs', () => {
      const state = createState({ briefs: [{ id: 'brief-1' }] as any, briefsScope: SCOPE });
      expect(briefListSelectors.hasBriefs(SCOPE)(state)).toBe(true);
    });

    it('should return false when the briefs belong to another scope', () => {
      const state = createState({ briefs: [{ id: 'brief-1' }] as any, briefsScope: OTHER_SCOPE });
      expect(briefListSelectors.hasBriefs(SCOPE)(state)).toBe(false);
    });
  });

  describe('isBriefsInit', () => {
    it('should return false by default', () => {
      const state = createState();
      expect(briefListSelectors.isBriefsInit(SCOPE)(state)).toBe(false);
    });

    it('should return true when initialized for the active scope', () => {
      const state = createState({ briefsScope: SCOPE, isBriefsInit: true });
      expect(briefListSelectors.isBriefsInit(SCOPE)(state)).toBe(true);
    });

    // Reporting "loaded" for a foreign scope is what suppressed the skeleton and
    // let the unreachable cards render.
    it('should report not-initialized when the loaded scope differs', () => {
      const state = createState({ briefsScope: OTHER_SCOPE, isBriefsInit: true });
      expect(briefListSelectors.isBriefsInit(SCOPE)(state)).toBe(false);
    });
  });
});
