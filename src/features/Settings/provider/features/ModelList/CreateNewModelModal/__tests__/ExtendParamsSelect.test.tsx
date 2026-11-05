import { describe, expect, it } from 'vitest';

import { normalizeExtendParamsValue } from '../ExtendParamsSelect';

describe('ExtendParamsSelect', () => {
  describe('normalizeExtendParamsValue', () => {
    const definitionMap = new Map([
      ['enableReasoning', { key: 'enableReasoning' }],
      ['reasoningMode', { key: 'reasoningMode' }],
      ['reasoningBudgetToken', { key: 'reasoningBudgetToken' }],
    ]) as any;

    it('should keep an explicit empty array when cleared', () => {
      expect(normalizeExtendParamsValue([], definitionMap)).toEqual([]);
      expect(normalizeExtendParamsValue(undefined, definitionMap)).toEqual([]);
    });

    it('should filter unsupported extend params while keeping valid values', () => {
      expect(
        normalizeExtendParamsValue(
          ['enableReasoning', 'unsupportedParam', 'reasoningMode', 'reasoningBudgetToken'] as any,
          definitionMap,
        ),
      ).toEqual(['enableReasoning', 'reasoningMode', 'reasoningBudgetToken']);
    });
  });
});
