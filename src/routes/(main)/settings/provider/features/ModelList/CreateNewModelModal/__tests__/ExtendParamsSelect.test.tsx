import { describe, expect, it } from 'vitest';

import { normalizeExtendParamsValue } from '../ExtendParamsSelect';

// Import the constant directly for testing
// We'll need to test the TITLE_KEY_ALIASES logic

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

  describe('TITLE_KEY_ALIASES mapping', () => {
    // This mapping should be synced with ControlsForm.tsx
    const TITLE_KEY_ALIASES: Record<string, string> = {
      gpt5ReasoningEffort: 'reasoningEffort',
      gpt5_1ReasoningEffort: 'reasoningEffort',
      gpt5_2ProReasoningEffort: 'reasoningEffort',
      gpt5_2ReasoningEffort: 'reasoningEffort',
      gpt5_6ReasoningEffort: 'reasoningEffort',
      glm5_2ReasoningEffort: 'reasoningEffort',
      thinkingLevel2: 'thinkingLevel',
    };

    it('should map GPT5 variants to reasoningEffort', () => {
      expect(TITLE_KEY_ALIASES['gpt5ReasoningEffort']).toBe('reasoningEffort');
      expect(TITLE_KEY_ALIASES['gpt5_1ReasoningEffort']).toBe('reasoningEffort');
      expect(TITLE_KEY_ALIASES['gpt5_2ReasoningEffort']).toBe('reasoningEffort');
      expect(TITLE_KEY_ALIASES['gpt5_2ProReasoningEffort']).toBe('reasoningEffort');
      expect(TITLE_KEY_ALIASES['gpt5_6ReasoningEffort']).toBe('reasoningEffort');
    });

    it('should map GLM-5.2 variant to reasoningEffort', () => {
      expect(TITLE_KEY_ALIASES['glm5_2ReasoningEffort']).toBe('reasoningEffort');
    });

    it('should map thinkingLevel2 to thinkingLevel', () => {
      expect(TITLE_KEY_ALIASES['thinkingLevel2']).toBe('thinkingLevel');
    });

    it('should return undefined for keys without aliases', () => {
      expect(TITLE_KEY_ALIASES['reasoningEffort']).toBeUndefined();
      expect(TITLE_KEY_ALIASES['thinkingLevel']).toBeUndefined();
      expect(TITLE_KEY_ALIASES['thinking']).toBeUndefined();
    });
  });

  describe('title key resolution logic', () => {
    const TITLE_KEY_ALIASES: Record<string, string> = {
      gpt5ReasoningEffort: 'reasoningEffort',
      gpt5_1ReasoningEffort: 'reasoningEffort',
      gpt5_2ProReasoningEffort: 'reasoningEffort',
      gpt5_2ReasoningEffort: 'reasoningEffort',
      gpt5_6ReasoningEffort: 'reasoningEffort',
      glm5_2ReasoningEffort: 'reasoningEffort',
      thinkingLevel2: 'thinkingLevel',
    };

    const getTitleKey = (key: string): string => {
      return TITLE_KEY_ALIASES[key] ?? key;
    };

    it('should return the alias key when available', () => {
      expect(getTitleKey('gpt5ReasoningEffort')).toBe('reasoningEffort');
      expect(getTitleKey('glm5_2ReasoningEffort')).toBe('reasoningEffort');
      expect(getTitleKey('thinkingLevel2')).toBe('thinkingLevel');
    });

    it('should return the original key when no alias exists', () => {
      expect(getTitleKey('reasoningEffort')).toBe('reasoningEffort');
      expect(getTitleKey('thinking')).toBe('thinking');
      expect(getTitleKey('textVerbosity')).toBe('textVerbosity');
    });
  });
});
