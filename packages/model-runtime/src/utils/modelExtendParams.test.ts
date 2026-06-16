import type { LobeAgentChatConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyModelExtendParams, resolveDefaultThinkingLevelForModel } from './modelExtendParams';

const chatConfig = (config: Partial<LobeAgentChatConfig> = {}): LobeAgentChatConfig =>
  ({ ...config }) as LobeAgentChatConfig;

describe('applyModelExtendParams', () => {
  it('returns empty when the model has no extend params', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ enableReasoning: true }),
        extendParams: undefined,
        model: 'gpt-4',
      }),
    ).toEqual({});

    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ thinkingLevel3: 'high' }),
        extendParams: [],
        model: 'gemini-3.1-pro-preview',
      }),
    ).toEqual({});
  });

  // Gemini 3 Pro via the agent path (provider=lobehub) billed reasoning tokens but
  // returned empty thinking summaries because thinkingLevel never reached the
  // request. With the model's extendParams present, thinkingLevel must default
  // to 'high' even when the chat config does not set thinkingLevel3.
  it('defaults thinkingLevel to high for gemini-3.1-pro-preview (thinkingLevel3)', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({}),
      extendParams: ['thinkingLevel3', 'urlContext'],
      model: 'gemini-3.1-pro-preview',
    });

    expect(result.thinkingLevel).toBe('high');
  });

  it('honors an explicit thinkingLevel3 config value', () => {
    const result = applyModelExtendParams({
      chatConfig: chatConfig({ thinkingLevel3: 'medium' }),
      extendParams: ['thinkingLevel3'],
      model: 'gemini-3.1-pro-preview',
    });

    expect(result.thinkingLevel).toBe('medium');
  });

  it('forwards urlContext only when enabled in the chat config', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ urlContext: true }),
        extendParams: ['thinkingLevel3', 'urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBe(true);

    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({}),
        extendParams: ['thinkingLevel3', 'urlContext'],
        model: 'gemini-3.1-pro-preview',
      }).urlContext,
    ).toBeUndefined();
  });

  it('resolves reasoning effort variants', () => {
    expect(
      applyModelExtendParams({
        chatConfig: chatConfig({ reasoningEffort: 'high' }),
        extendParams: ['reasoningEffort'],
        model: 'some-model',
      }).reasoning_effort,
    ).toBe('high');
  });
});

describe('resolveDefaultThinkingLevelForModel', () => {
  it('falls back to high without a model', () => {
    expect(resolveDefaultThinkingLevelForModel()).toBe('high');
  });

  it('uses per-model defaults', () => {
    expect(resolveDefaultThinkingLevelForModel('gemini-3.5-flash')).toBe('medium');
    expect(resolveDefaultThinkingLevelForModel('gemini-3.1-flash-lite')).toBe('minimal');
  });
});
