import { describe, expect, it } from 'vitest';

import {
  AiModelReasoningEffortSettingsSchema,
  resolveReasoningEffortLevel,
  resolveReasoningEffortSettings,
} from './reasoningEffort';

describe('AiModelReasoningEffortSettingsSchema', () => {
  it('accepts a control without a default', () => {
    expect(
      AiModelReasoningEffortSettingsSchema.safeParse({ levels: ['low', 'high'] }).success,
    ).toBe(true);
  });

  // The middle-level fallback reads the list as given, so `['high', 'low']`
  // would resolve to `low`.
  it.each([[['high', 'low']], [['low', 'low', 'high']]])('rejects levels %j', (levels) => {
    expect(AiModelReasoningEffortSettingsSchema.safeParse({ levels }).success).toBe(false);
  });
});

describe('resolveReasoningEffortSettings', () => {
  it('keeps the declared default', () => {
    expect(
      resolveReasoningEffortSettings({ default: 'low', levels: ['low', 'high'] }, [
        { default: 'high', levels: ['low', 'high'] },
      ]),
    ).toEqual({ default: 'low', levels: ['low', 'high'] });
  });

  it('takes an undeclared default from the same model under another provider', () => {
    expect(
      resolveReasoningEffortSettings({ levels: ['low', 'medium', 'high', 'max'] }, [
        { levels: ['low', 'high'] },
        { default: 'high', levels: ['low', 'medium', 'high', 'max'] },
      ])?.default,
    ).toBe('high');
  });

  it('skips a same-model default this control does not offer', () => {
    expect(
      resolveReasoningEffortSettings({ levels: ['low', 'medium', 'high'] }, [
        { default: 'max', levels: ['low', 'high', 'max'] },
      ])?.default,
    ).toBe('medium');
  });

  it('falls back to the upper middle level', () => {
    expect(resolveReasoningEffortSettings({ levels: ['high', 'max'] })?.default).toBe('max');
  });

  it('borrows the same model’s control when the own card has none', () => {
    expect(
      resolveReasoningEffortSettings(undefined, [
        undefined,
        { default: 'low', levels: ['low', 'high'] },
      ]),
    ).toEqual({ default: 'low', levels: ['low', 'high'] });
  });

  it('returns undefined when no card declares a control', () => {
    expect(resolveReasoningEffortSettings(undefined, [undefined])).toBeUndefined();
  });
});

describe('resolveReasoningEffortLevel', () => {
  it('uses the pick when offered, else the resolved default', () => {
    const settings = { default: 'high', levels: ['low', 'high'] } as const;
    expect(resolveReasoningEffortLevel({ ...settings, levels: [...settings.levels] }, 'low')).toBe(
      'low',
    );
    expect(
      resolveReasoningEffortLevel({ ...settings, levels: [...settings.levels] }, 'medium'),
    ).toBe('high');
  });
});
