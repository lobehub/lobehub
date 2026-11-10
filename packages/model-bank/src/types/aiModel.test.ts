import { describe, expect, it } from 'vitest';

import {
  AiModelReasoningConfigSchema,
  CompressionThresholdRatioSchema,
  CreateAiModelSchema,
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

  it('strips the catalog-owned compression ratio from user mutations', () => {
    expect(
      CreateAiModelSchema.parse({
        compressionThresholdRatio: 0.9,
        id: 'custom-model',
        providerId: 'custom-provider',
      }),
    ).toEqual({ id: 'custom-model', providerId: 'custom-provider' });

    expect(UpdateAiModelSchema.parse({ compressionThresholdRatio: 0.9 })).toEqual({});
  });
});

describe('CompressionThresholdRatioSchema', () => {
  it('accepts a share of the window in (0, 1]', () => {
    expect(CompressionThresholdRatioSchema.parse(0.75)).toBe(0.75);
    expect(CompressionThresholdRatioSchema.parse(1)).toBe(1);
  });

  it.each([0, -0.1, 1.2])('rejects %s', (ratio) => {
    expect(CompressionThresholdRatioSchema.safeParse(ratio).success).toBe(false);
  });
});

describe('Gemini reasoning config persistence', () => {
  it('preserves supported thinking levels and rejects invalid levels', () => {
    const config = {
      thinkingLevel: 'minimal',
      thinkingLevel2: 'low',
      thinkingLevel3: 'medium',
      thinkingLevel4: 'high',
    };
    expect(AiModelReasoningConfigSchema.parse(config)).toEqual(config);
    expect(AiModelReasoningConfigSchema.safeParse({ thinkingLevel3: 'minimal' }).success).toBe(
      false,
    );
    expect(AiModelReasoningConfigSchema.safeParse({ thinkingLevel4: 'medium' }).success).toBe(
      false,
    );
  });
});
