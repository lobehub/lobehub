import { describe, expect, it } from 'vitest';

import {
  getServerDefaultHeterogeneousAgentConfig,
  isServerDefaultHeterogeneousAgentType,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES,
} from './serverDefault';

describe('server-default heterogeneous agent matrix', () => {
  it('declares the native relay ingress and credential contract for every supported agent', () => {
    expect(SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES).toEqual([
      'droid',
      'claude-code',
      'codex',
      'grok-build',
      'kimi-code',
      'pi',
      'opencode',
      'trae',
    ]);
    expect(SERVER_DEFAULT_HETEROGENEOUS_AGENT_CONFIG).toEqual({
      'droid': {
        ingress: 'anthropic-messages',
        tokenHeader: 'x-api-key',
      },
      'claude-code': {
        ingress: 'anthropic-messages',
        tokenHeader: 'bearer',
      },
      'codex': {
        ingress: 'openai-responses',
        tokenHeader: 'bearer',
      },
      'grok-build': {
        ingress: 'openai-responses',
        tokenHeader: 'bearer',
      },
      'kimi-code': {
        ingress: 'anthropic-messages',
        tokenHeader: 'x-api-key',
      },
      'pi': {
        ingress: 'openai-responses',
        tokenHeader: 'bearer',
      },
      'opencode': {
        ingress: 'openai-responses',
        tokenHeader: 'bearer',
      },
      'trae': {
        ingress: 'openai-responses',
        tokenHeader: 'bearer',
      },
    });
  });

  it('looks up and narrows only supported agent types', () => {
    expect(getServerDefaultHeterogeneousAgentConfig('kimi-code')).toEqual({
      ingress: 'anthropic-messages',
      tokenHeader: 'x-api-key',
    });
    expect(isServerDefaultHeterogeneousAgentType('pi')).toBe(true);
    expect(isServerDefaultHeterogeneousAgentType('trae')).toBe(true);
    expect(isServerDefaultHeterogeneousAgentType('opencode')).toBe(true);
    expect(isServerDefaultHeterogeneousAgentType('amp')).toBe(false);
    expect(isServerDefaultHeterogeneousAgentType('toString')).toBe(false);
    expect(getServerDefaultHeterogeneousAgentConfig(undefined)).toBeUndefined();
  });
});
