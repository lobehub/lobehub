import { describe, expect, it } from 'vitest';

import {
  buildTTSVoiceOptions,
  CUSTOM_MODEL_TYPES,
  hasDuplicateModelId,
  setReasoningEffortControlsThinking,
  updateReasoningEffortLevels,
} from '../utils';

describe('CUSTOM_MODEL_TYPES', () => {
  it('should not offer image or video, which require a parameters schema', () => {
    expect(CUSTOM_MODEL_TYPES).not.toContain('image');
    expect(CUSTOM_MODEL_TYPES).not.toContain('video');
  });

  it('should keep the other generation types selectable', () => {
    expect(CUSTOM_MODEL_TYPES).toContain('text2music');
  });
});

describe('hasDuplicateModelId', () => {
  it('should detect an existing model id', () => {
    expect(hasDuplicateModelId('claude-opus-4-8', ['claude-opus-4-8'])).toBe(true);
  });

  it('should ignore empty model ids', () => {
    expect(hasDuplicateModelId('   ', ['claude-opus-4-8'])).toBe(false);
  });

  it('should allow a different model id', () => {
    expect(hasDuplicateModelId('claude-sonnet-4-6', ['claude-opus-4-8'])).toBe(false);
  });
});

describe('buildTTSVoiceOptions', () => {
  it('labels each catalog voice with its style and submits the voice id', () => {
    expect(
      buildTTSVoiceOptions([
        {
          description: 'Firm',
          displayName: 'Kore',
          gender: 'female',
          id: 'Kore',
          language: 'multilingual',
        },
        { displayName: 'Roger', gender: 'male', id: 'CwhRBWXzGAHq8TQ4Fs17', language: 'en-US' },
      ]),
    ).toEqual([
      { label: 'Kore · Firm', value: 'Kore' },
      { label: 'Roger', value: 'CwhRBWXzGAHq8TQ4Fs17' },
    ]);
  });

  it('returns no options for a model without a catalog, so the free voice id input is shown', () => {
    expect(buildTTSVoiceOptions(undefined)).toEqual([]);
  });
});

describe('updateReasoningEffortLevels', () => {
  it('removes the control when every level is cleared', () => {
    expect(updateReasoningEffortLevels({ default: 'high', levels: ['high'] }, [])).toBeUndefined();
  });

  it('keeps the chosen default and the thinking flag while the default is still offered', () => {
    expect(
      updateReasoningEffortLevels(
        { controlsThinking: true, default: 'high', levels: ['none', 'high'] },
        ['max', 'none', 'high'],
      ),
    ).toEqual({ controlsThinking: true, default: 'high', levels: ['none', 'high', 'max'] });
  });

  it('clears the default when it is unchecked, so it resolves at runtime', () => {
    expect(
      updateReasoningEffortLevels({ default: 'max', levels: ['low', 'high', 'max'] }, [
        'low',
        'medium',
        'high',
      ]),
    ).toEqual({ levels: ['low', 'medium', 'high'] });
  });
});

describe('setReasoningEffortControlsThinking', () => {
  const spec = { default: 'high' as const, levels: ['none' as const, 'high' as const] };

  it('lets a custom model couple its effort with thinking', () => {
    expect(setReasoningEffortControlsThinking(spec, true)).toEqual({
      ...spec,
      controlsThinking: true,
    });
  });

  it('drops the flag when unchecked', () => {
    expect(setReasoningEffortControlsThinking({ ...spec, controlsThinking: true }, false)).toEqual(
      spec,
    );
  });
});
