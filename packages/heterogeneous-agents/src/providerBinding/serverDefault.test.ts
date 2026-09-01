import { describe, expect, it } from 'vitest';

import {
  getServerDefaultHeterogeneousAgentConfig,
  isServerDefaultHeterogeneousAgentType,
  isServerDefaultHeterogeneousProfileModel,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES,
  SERVER_DEFAULT_HETEROGENEOUS_PROFILE_DEFAULT_MODELS,
} from './serverDefault';

describe('server-default heterogeneous agent matrix', () => {
  it('declares the native relay ingress and credential contract for every supported agent', () => {
    expect(SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES).toEqual([
      'claude-code',
      'codex',
      'grok-build',
      'kimi-code',
      'pi',
      'trae',
    ]);
    expect(SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG).toEqual({
      'claude-code': {
        ingress: 'anthropic-messages',
        modelPolicy: 'tool-capable',
        tokenHeader: 'bearer',
      },
      'codex': {
        ingress: 'openai-responses',
        modelPolicy: 'codex',
        tokenHeader: 'bearer',
      },
      'grok-build': {
        ingress: 'openai-responses',
        modelPolicy: 'tool-capable',
        tokenHeader: 'bearer',
      },
      'kimi-code': {
        compatibilityProfile: 'kimi-code/anthropic-v1',
        ingress: 'anthropic-messages',
        modelPolicy: 'profile-attested',
        tokenHeader: 'x-api-key',
      },
      'pi': {
        ingress: 'openai-responses',
        modelPolicy: 'tool-capable',
        tokenHeader: 'bearer',
      },
      'trae': {
        ingress: 'openai-responses',
        modelPolicy: 'tool-capable',
        tokenHeader: 'bearer',
      },
    });
  });

  it('looks up and narrows only supported agent types', () => {
    expect(getServerDefaultHeterogeneousAgentConfig('kimi-code')).toEqual({
      compatibilityProfile: 'kimi-code/anthropic-v1',
      ingress: 'anthropic-messages',
      modelPolicy: 'profile-attested',
      tokenHeader: 'x-api-key',
    });
    expect(isServerDefaultHeterogeneousAgentType('pi')).toBe(true);
    expect(isServerDefaultHeterogeneousAgentType('opencode')).toBe(false);
    expect(isServerDefaultHeterogeneousAgentType('toString')).toBe(false);
    expect(getServerDefaultHeterogeneousAgentConfig(undefined)).toBeUndefined();
  });

  it('bootstraps the Kimi Anthropic profile from the clean compatibility matrix', () => {
    expect(SERVER_DEFAULT_HETEROGENEOUS_PROFILE_DEFAULT_MODELS['kimi-code/anthropic-v1']).toEqual([
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
      'grok-4.6',
      'grok-4.5',
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'lobehub-glm-5.2-fast',
      'kimi-k3',
      'lobehub-kimi-k3-fast',
      'kimi-k2.7-code',
      'qwen3.8-max',
      'qwen3.8-max-preview',
      'MiniMax-M3',
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'lobehub-onboarding-v1',
    ]);
    expect(isServerDefaultHeterogeneousProfileModel('kimi-code/anthropic-v1', 'kimi-k3')).toBe(
      true,
    );
    expect(isServerDefaultHeterogeneousProfileModel('kimi-code/anthropic-v1', 'gpt-5.6-sol')).toBe(
      false,
    );
    expect(
      isServerDefaultHeterogeneousProfileModel('kimi-code/anthropic-v1', 'gemini-3.7-flash'),
    ).toBe(false);
  });
});
