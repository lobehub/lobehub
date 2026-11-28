import { describe, expect, it } from 'vitest';

import {
  AiModelReasoningConfigSchema,
  AiModelReasoningConfigWriteSchema,
  AiModelSettingsWriteSchema,
  CreateAiModelSchema,
  translateLegacyModelSettings,
  UpdateAiModelSchema,
} from './aiModel';

describe('AI model mutation schemas', () => {
  it('strips deployment-owned compatibility metadata from user mutations', () => {
    const agentCompatibility = {
      serverDefaultHeterogeneousProfiles: ['kimi-code/anthropic-v1'],
    };

    expect(
      CreateAiModelSchema.parse({
        agentCompatibility,
        id: 'custom-model',
        providerId: 'custom-provider',
      }),
    ).toEqual({ id: 'custom-model', providerId: 'custom-provider' });

    expect(UpdateAiModelSchema.parse({ agentCompatibility })).toEqual({});
  });

  it('accepts a null config so re-saving a model without config does not fail', () => {
    // The model-config modal submits the whole model card; models whose `config`
    // column is NULL read back as `null` and were rejected as an invalid object.
    expect(UpdateAiModelSchema.parse({ config: null })).toEqual({ config: null });
    expect(UpdateAiModelSchema.safeParse({ config: { deploymentName: 'deploy' } }).success).toBe(
      true,
    );
    expect(UpdateAiModelSchema.safeParse({ config: 'not-an-object' }).success).toBe(false);
  });
});

describe('AiModelReasoningConfigSchema', () => {
  it('keeps a known effort level and rejects an unknown one', () => {
    const config = { reasoningEffort: 'minimal', reasoningMode: 'pro' };
    expect(AiModelReasoningConfigSchema.parse(config)).toEqual(config);
    expect(AiModelReasoningConfigSchema.safeParse({ reasoningEffort: 'ultra' }).success).toBe(
      false,
    );
  });
});

describe('released-client write schemas', () => {
  it('keeps the legacy effort keys for the write path to translate', () => {
    expect(AiModelReasoningConfigWriteSchema.parse({ gpt5_6ReasoningEffort: 'max' })).toEqual({
      gpt5_6ReasoningEffort: 'max',
    });
    expect(AiModelReasoningConfigWriteSchema.safeParse({ reasoningEffort: 'ultra' }).success).toBe(
      false,
    );
  });

  it('accepts legacy effort extend params and moves them to settings.reasoningEffort', () => {
    const settings = AiModelSettingsWriteSchema.parse({
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    });
    expect(translateLegacyModelSettings(settings, { cardDeclaresEffort: false })).toEqual({
      extendParams: ['textVerbosity'],
      reasoningEffort: { levels: ['minimal', 'low', 'medium', 'high'] },
    });
    expect(translateLegacyModelSettings(settings, { cardDeclaresEffort: true })).toEqual({
      extendParams: ['textVerbosity'],
    });
  });

  it('still rejects unknown extend params', () => {
    expect(AiModelSettingsWriteSchema.safeParse({ extendParams: ['nope'] }).success).toBe(false);
  });
});
