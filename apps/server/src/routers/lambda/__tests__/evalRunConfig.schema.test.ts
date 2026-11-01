import { describe, expect, it } from 'vitest';

import { evalCaseSelectionSchema } from '../evalRunConfig.schema';

describe('evalCaseSelectionSchema', () => {
  describe('canonical "all" — normalizes to omission', () => {
    it('omitted caseSelection parses to undefined (= all cases)', () => {
      const result = evalCaseSelectionSchema.optional().safeParse(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('explicit {mode:all} with absent caseIds normalizes to undefined', () => {
      const result = evalCaseSelectionSchema.safeParse({ mode: 'all' });
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('explicit {mode:all} with empty caseIds normalizes to undefined', () => {
      const result = evalCaseSelectionSchema.safeParse({ caseIds: [], mode: 'all' });
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('rejects {mode:all} with non-empty caseIds', () => {
      expect(evalCaseSelectionSchema.safeParse({ caseIds: ['c1'], mode: 'all' }).success).toBe(
        false,
      );
    });

    it('exclude with empty caseIds normalizes to undefined (= all)', () => {
      const result = evalCaseSelectionSchema.safeParse({ caseIds: [], mode: 'exclude' });
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('exclude with missing caseIds normalizes to undefined (= all)', () => {
      const result = evalCaseSelectionSchema.safeParse({ mode: 'exclude' });
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });
  });

  describe('include/exclude — validated and persisted unchanged', () => {
    it('accepts include with unique non-blank caseIds, unchanged', () => {
      const input = { caseIds: ['case_1', 'case_2'], mode: 'include' } as const;
      const result = evalCaseSelectionSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it('accepts exclude with unique non-blank caseIds, unchanged', () => {
      const input = { caseIds: ['case_9'], mode: 'exclude' } as const;
      const result = evalCaseSelectionSchema.safeParse(input);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it('rejects include without caseIds', () => {
      expect(evalCaseSelectionSchema.safeParse({ mode: 'include' }).success).toBe(false);
    });

    it('rejects include with empty caseIds', () => {
      expect(evalCaseSelectionSchema.safeParse({ caseIds: [], mode: 'include' }).success).toBe(
        false,
      );
    });

    it('rejects blank caseIds', () => {
      expect(
        evalCaseSelectionSchema.safeParse({ caseIds: ['ok', '  '], mode: 'include' }).success,
      ).toBe(false);
    });

    it('rejects duplicate caseIds', () => {
      expect(
        evalCaseSelectionSchema.safeParse({ caseIds: ['c1', 'c1'], mode: 'exclude' }).success,
      ).toBe(false);
    });
  });
});
