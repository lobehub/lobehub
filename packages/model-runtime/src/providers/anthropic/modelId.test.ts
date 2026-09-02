import { describe, expect, it } from 'vitest';

import {
  hasTemperatureTopPConflict,
  isAdaptiveThinkingDefaultOnModel,
  isAlwaysThinkingClaudeModel,
  isContextCachingModel,
  isThinkingDisplayOmittedByDefaultModel,
  isThinkingWithToolClaudeModel,
  parseClaudeModelId,
  rejectsDisabledThinkingAtEffort,
  rejectsForcedToolChoice,
  shouldDropUnsupportedClaudeAssistantPrefill,
  shouldOmitSamplingParams,
} from './modelId';

describe('parseClaudeModelId', () => {
  it('should parse native family-first Claude ids', () => {
    expect(parseClaudeModelId('claude-opus-4-8')).toEqual({
      family: 'opus',
      majorVersion: 4,
      minorSeparator: '-',
      minorVersion: 8,
      normalizedModelId: 'claude-opus-4-8',
      source: 'anthropic',
    });
  });

  it('should parse native version-first Claude ids', () => {
    expect(parseClaudeModelId('claude-3-5-sonnet-20240620')).toEqual({
      family: 'sonnet',
      majorVersion: 3,
      minorSeparator: '-',
      minorVersion: 5,
      normalizedModelId: 'claude-3-5-sonnet-20240620',
      source: 'anthropic',
    });
  });

  it('should parse OpenRouter Claude ids with dot minor versions', () => {
    expect(parseClaudeModelId('anthropic/claude-4.7-opus')).toEqual({
      family: 'opus',
      majorVersion: 4,
      minorSeparator: '.',
      minorVersion: 7,
      normalizedModelId: 'claude-4.7-opus',
      source: 'openRouter',
    });
  });

  it('should parse Bedrock Claude ids with region prefixes', () => {
    expect(parseClaudeModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toEqual({
      family: 'sonnet',
      majorVersion: 4,
      minorSeparator: '-',
      minorVersion: 5,
      normalizedModelId: 'claude-sonnet-4-5-20250929-v1:0',
      source: 'bedrock',
    });
  });

  it('should not treat release dates as minor versions', () => {
    expect(parseClaudeModelId('claude-opus-4-20250514')).toEqual({
      family: 'opus',
      majorVersion: 4,
      normalizedModelId: 'claude-opus-4-20250514',
      source: 'anthropic',
    });
  });

  it('should parse Claude 5 family ids', () => {
    expect(parseClaudeModelId('claude-mythos-5-preview')).toEqual({
      family: 'mythos',
      majorVersion: 5,
      normalizedModelId: 'claude-mythos-5-preview',
      source: 'anthropic',
    });
    expect(parseClaudeModelId('claude-fable-5-1')).toEqual({
      family: 'fable',
      majorVersion: 5,
      minorSeparator: '-',
      minorVersion: 1,
      normalizedModelId: 'claude-fable-5-1',
      source: 'anthropic',
    });
  });

  it('should return undefined for non-Claude ids', () => {
    expect(parseClaudeModelId('gpt-5.4')).toBeUndefined();
  });
});

describe('isContextCachingModel', () => {
  it('should return true for current Claude context-caching families', () => {
    expect(isContextCachingModel('claude-opus-4-20250514')).toBe(true);
    expect(isContextCachingModel('claude-sonnet-4-5-20250929')).toBe(true);
    expect(isContextCachingModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isContextCachingModel('claude-3-7-sonnet-20250219')).toBe(true);
    expect(isContextCachingModel('claude-3-5-haiku-20241022')).toBe(true);
  });

  it('should return true for Claude 5 ids', () => {
    expect(isContextCachingModel('claude-mythos-5-preview')).toBe(true);
    expect(isContextCachingModel('anthropic/claude-5-mythos')).toBe(true);
    expect(isContextCachingModel('us.anthropic.claude-mythos-5-v1:0')).toBe(true);
  });

  it('should preserve existing false cases', () => {
    expect(isContextCachingModel('claude-3-opus-20240229')).toBe(false);
    expect(isContextCachingModel('gpt-4o')).toBe(false);
  });
});

describe('isThinkingWithToolClaudeModel', () => {
  it('should return true for current Claude thinking-with-tools families', () => {
    expect(isThinkingWithToolClaudeModel('claude-opus-4-20250514')).toBe(true);
    expect(isThinkingWithToolClaudeModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isThinkingWithToolClaudeModel('claude-3-7-sonnet-20250219')).toBe(true);
  });

  it('should return true for Claude 5 ids', () => {
    expect(isThinkingWithToolClaudeModel('claude-mythos-5-preview')).toBe(true);
    expect(isThinkingWithToolClaudeModel('anthropic/claude-5-mythos')).toBe(true);
    expect(isThinkingWithToolClaudeModel('us.anthropic.claude-mythos-5-v1:0')).toBe(true);
  });

  it('should preserve existing false cases', () => {
    expect(isThinkingWithToolClaudeModel('claude-3-5-sonnet-20240620')).toBe(false);
    expect(isThinkingWithToolClaudeModel('gpt-4o')).toBe(false);
  });
});

describe('isAdaptiveThinkingDefaultOnModel', () => {
  it('should return true for Claude 5 ids across provider spellings', () => {
    expect(isAdaptiveThinkingDefaultOnModel('claude-opus-5')).toBe(true);
    expect(isAdaptiveThinkingDefaultOnModel('claude-sonnet-5')).toBe(true);
    expect(isAdaptiveThinkingDefaultOnModel('claude-fable-5')).toBe(true);
    expect(isAdaptiveThinkingDefaultOnModel('claude-opus-5-fast')).toBe(true);
    expect(isAdaptiveThinkingDefaultOnModel('anthropic/claude-opus-5')).toBe(true);
    expect(isAdaptiveThinkingDefaultOnModel('global.anthropic.claude-opus-5')).toBe(true);
  });

  it('should return false for Claude 4.x and non-Claude ids', () => {
    expect(isAdaptiveThinkingDefaultOnModel('claude-opus-4-8')).toBe(false);
    expect(isAdaptiveThinkingDefaultOnModel('claude-opus-4-7')).toBe(false);
    expect(isAdaptiveThinkingDefaultOnModel('claude-sonnet-4.6')).toBe(false);
    expect(isAdaptiveThinkingDefaultOnModel('claude-haiku-4-5-20251001')).toBe(false);
    expect(isAdaptiveThinkingDefaultOnModel('gpt-5')).toBe(false);
  });
});

describe('isAlwaysThinkingClaudeModel', () => {
  it('should return true for the families that reject disabled thinking', () => {
    expect(isAlwaysThinkingClaudeModel('claude-fable-5')).toBe(true);
    expect(isAlwaysThinkingClaudeModel('claude-fable-5-1')).toBe(true);
    expect(isAlwaysThinkingClaudeModel('claude-mythos-5')).toBe(true);
    expect(isAlwaysThinkingClaudeModel('global.anthropic.claude-fable-5-1')).toBe(true);
    expect(isAlwaysThinkingClaudeModel('anthropic/claude-fable-5')).toBe(true);
    expect(isAlwaysThinkingClaudeModel('global.anthropic.claude-fable-5')).toBe(true);
  });

  it('should return false for models that accept disabled thinking', () => {
    expect(isAlwaysThinkingClaudeModel('claude-opus-5')).toBe(false);
    expect(isAlwaysThinkingClaudeModel('claude-sonnet-5')).toBe(false);
    expect(isAlwaysThinkingClaudeModel('claude-opus-4-8')).toBe(false);
    expect(isAlwaysThinkingClaudeModel('claude-sonnet-4-6')).toBe(false);
    expect(isAlwaysThinkingClaudeModel('gpt-5')).toBe(false);
  });
});

describe('isThinkingDisplayOmittedByDefaultModel', () => {
  it('should return true for Claude 5 and Opus 4.7 / 4.8', () => {
    expect(isThinkingDisplayOmittedByDefaultModel('claude-fable-5')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-5')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-sonnet-5')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-4-8')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-4-7')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-4.7')).toBe(true);
    expect(isThinkingDisplayOmittedByDefaultModel('global.anthropic.claude-sonnet-5')).toBe(true);
  });

  it('should return false for models that still default to summarized', () => {
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-4-6')).toBe(false);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-sonnet-4-6')).toBe(false);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-sonnet-4-5-20250929')).toBe(false);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-opus-4-5-20251101')).toBe(false);
    expect(isThinkingDisplayOmittedByDefaultModel('claude-haiku-4-5-20251001')).toBe(false);
    expect(isThinkingDisplayOmittedByDefaultModel('gpt-5')).toBe(false);
  });
});

describe('rejectsForcedToolChoice', () => {
  it('should reject forced tool_choice on Fable 5.1 / Mythos 5.1 and later', () => {
    expect(rejectsForcedToolChoice('claude-fable-5-1')).toBe(true);
    expect(rejectsForcedToolChoice('claude-mythos-5-1')).toBe(true);
    expect(rejectsForcedToolChoice('global.anthropic.claude-fable-5-1')).toBe(true);
    expect(rejectsForcedToolChoice('anthropic/claude-fable-5-1')).toBe(true);
  });

  it('should keep forced tool_choice valid on Fable 5 / Mythos 5 and other families', () => {
    expect(rejectsForcedToolChoice('claude-fable-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-mythos-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-opus-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-sonnet-5')).toBe(false);
    expect(rejectsForcedToolChoice('claude-opus-4-8')).toBe(false);
    expect(rejectsForcedToolChoice('gpt-5')).toBe(false);
  });
});

describe('rejectsDisabledThinkingAtEffort', () => {
  it('should only reject the xhigh / max pairing on Claude 5 and later', () => {
    expect(rejectsDisabledThinkingAtEffort('claude-opus-5', 'xhigh')).toBe(true);
    expect(rejectsDisabledThinkingAtEffort('claude-opus-5', 'max')).toBe(true);
    expect(rejectsDisabledThinkingAtEffort('global.anthropic.claude-sonnet-5', 'max')).toBe(true);
  });

  it('should keep every lower effort level valid alongside disabled thinking', () => {
    expect(rejectsDisabledThinkingAtEffort('claude-opus-5', 'high')).toBe(false);
    expect(rejectsDisabledThinkingAtEffort('claude-sonnet-5', 'high')).toBe(false);
    expect(rejectsDisabledThinkingAtEffort('claude-opus-5', 'medium')).toBe(false);
    expect(rejectsDisabledThinkingAtEffort('claude-opus-5', 'low')).toBe(false);
  });

  it('should not apply to earlier models or non-Claude ids', () => {
    expect(rejectsDisabledThinkingAtEffort('claude-opus-4-8', 'xhigh')).toBe(false);
    expect(rejectsDisabledThinkingAtEffort('claude-opus-4-6', 'max')).toBe(false);
    expect(rejectsDisabledThinkingAtEffort('gpt-5', 'xhigh')).toBe(false);
  });
});

describe('hasTemperatureTopPConflict', () => {
  describe('Anthropic Claude 4+ models', () => {
    it('should return true for Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('claude-opus-4-1-20250805')).toBe(true);
      expect(hasTemperatureTopPConflict('claude-sonnet-4-5-20250929')).toBe(true);
      expect(hasTemperatureTopPConflict('claude-haiku-4-5-20251001')).toBe(true);
    });

    it('should return false for Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('claude-3-opus-20240229')).toBe(false);
      expect(hasTemperatureTopPConflict('claude-3-5-sonnet-20240620')).toBe(false);
    });
  });

  describe('OpenRouter Claude 4+ models', () => {
    it('should return true for OpenRouter Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('anthropic/claude-opus-4.5')).toBe(true);
      expect(hasTemperatureTopPConflict('anthropic/claude-sonnet-4.1')).toBe(true);
      expect(hasTemperatureTopPConflict('anthropic/claude-4.5-opus')).toBe(true);
    });

    it('should return false for OpenRouter Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('anthropic/claude-3.5-sonnet')).toBe(false);
      expect(hasTemperatureTopPConflict('anthropic/claude-3.7-sonnet')).toBe(false);
    });
  });

  describe('Bedrock Claude 4+ models', () => {
    it('should return true for Bedrock Claude 4+ models', () => {
      expect(hasTemperatureTopPConflict('anthropic.claude-opus-4-1-20250805-v1:0')).toBe(true);
      expect(hasTemperatureTopPConflict('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true);
    });

    it('should return false for Bedrock Claude 3.x models', () => {
      expect(hasTemperatureTopPConflict('anthropic.claude-3-5-sonnet-20240620-v1:0')).toBe(false);
    });
  });

  describe('Claude 5 models', () => {
    it('should return true for Claude 5 ids across providers', () => {
      expect(hasTemperatureTopPConflict('claude-mythos-5-preview')).toBe(true);
      expect(hasTemperatureTopPConflict('anthropic/claude-5-mythos')).toBe(true);
      expect(hasTemperatureTopPConflict('us.anthropic.claude-mythos-5-v1:0')).toBe(true);
    });
  });
});

describe('shouldOmitSamplingParams', () => {
  it('should return true for Claude Opus 4.7 (Anthropic API id)', () => {
    expect(shouldOmitSamplingParams('claude-opus-4-7')).toBe(true);
  });

  it('should return true for Claude Opus 4.8 (Anthropic API id)', () => {
    expect(shouldOmitSamplingParams('claude-opus-4-8')).toBe(true);
  });

  it('should return true for Claude Opus 4.7 on Bedrock (with and without region prefix)', () => {
    expect(shouldOmitSamplingParams('anthropic.claude-opus-4-7')).toBe(true);
    expect(shouldOmitSamplingParams('us.anthropic.claude-opus-4-7-v1')).toBe(true);
  });

  it('should return true for Claude Opus 4.8 on Bedrock (with and without region prefix)', () => {
    expect(shouldOmitSamplingParams('anthropic.claude-opus-4-8')).toBe(true);
    expect(shouldOmitSamplingParams('us.anthropic.claude-opus-4-8')).toBe(true);
  });

  it('should return true for Claude Opus 4.7 on OpenRouter (dot notation)', () => {
    expect(shouldOmitSamplingParams('anthropic/claude-opus-4.7')).toBe(true);
    expect(shouldOmitSamplingParams('anthropic/claude-4.7-opus')).toBe(true);
  });

  it('should return true for Claude Opus 4.8 on OpenRouter (dot notation)', () => {
    expect(shouldOmitSamplingParams('anthropic/claude-opus-4.8')).toBe(true);
    expect(shouldOmitSamplingParams('anthropic/claude-4.8-opus')).toBe(true);
  });

  it('should return false for hypothetical dash-form OpenRouter id', () => {
    // OpenRouter uses dot notation; dash form is not a real id and must not match
    // to avoid accidentally stripping params from unrelated future model ids.
    expect(shouldOmitSamplingParams('anthropic/claude-opus-4-7')).toBe(false);
  });

  it('should return false for Claude Opus 4.6 and earlier', () => {
    expect(shouldOmitSamplingParams('claude-opus-4-6')).toBe(false);
    expect(shouldOmitSamplingParams('claude-sonnet-4-5-20250929')).toBe(false);
    expect(shouldOmitSamplingParams('anthropic.claude-opus-4-6-v1')).toBe(false);
  });

  it('should return false for non-Claude models', () => {
    expect(shouldOmitSamplingParams('gpt-4o')).toBe(false);
    expect(shouldOmitSamplingParams('gemini-2.5-pro')).toBe(false);
  });

  it('should return true for Claude 5 ids', () => {
    expect(shouldOmitSamplingParams('claude-opus-5')).toBe(true);
    expect(shouldOmitSamplingParams('global.anthropic.claude-opus-5')).toBe(true);
    expect(shouldOmitSamplingParams('claude-mythos-5-preview')).toBe(true);
    expect(shouldOmitSamplingParams('anthropic/claude-5-mythos')).toBe(true);
    expect(shouldOmitSamplingParams('us.anthropic.claude-mythos-5-v1:0')).toBe(true);
  });
});

describe('shouldDropUnsupportedClaudeAssistantPrefill', () => {
  it('should return true for Claude Opus 4.8 API and Bedrock ids', () => {
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-opus-4-8')).toBe(true);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('anthropic.claude-opus-4-8')).toBe(true);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('us.anthropic.claude-opus-4-8')).toBe(true);
  });

  it('should return true for Claude 5 API and Bedrock ids', () => {
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-opus-5')).toBe(true);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('global.anthropic.claude-opus-5')).toBe(
      true,
    );
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-mythos-5-preview')).toBe(true);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('us.anthropic.claude-mythos-5-v1:0')).toBe(
      true,
    );
  });

  it('should preserve existing OpenRouter behavior', () => {
    expect(shouldDropUnsupportedClaudeAssistantPrefill('anthropic/claude-5-mythos')).toBe(false);
  });

  it('should cover every 4.6+ family and future 4.x minors (official cutoff is "4.6 and later")', () => {
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-haiku-4-6')).toBe(true);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-opus-4-9')).toBe(true);
  });

  it('should return false for models before 4.6', () => {
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-haiku-4-5')).toBe(false);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-opus-4-5')).toBe(false);
    expect(shouldDropUnsupportedClaudeAssistantPrefill('claude-3-7-sonnet-20250219')).toBe(false);
  });
});
