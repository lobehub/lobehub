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
      'claude-code',
      'codex',
      'grok-build',
      'kimi-code',
      'pi',
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
        ingress: 'anthropic-messages',
        modelPolicy: 'tool-capable',
        tokenHeader: 'x-api-key',
      },
      'pi': {
        ingress: 'openai-responses',
        modelPolicy: 'tool-capable',
        tokenHeader: 'bearer',
      },
    });
  });

  it('looks up and narrows only supported agent types', () => {
    expect(getServerDefaultHeterogeneousAgentConfig('kimi-code')).toEqual({
      ingress: 'anthropic-messages',
      modelPolicy: 'tool-capable',
      tokenHeader: 'x-api-key',
    });
    expect(isServerDefaultHeterogeneousAgentType('pi')).toBe(true);
    expect(isServerDefaultHeterogeneousAgentType('opencode')).toBe(false);
    expect(isServerDefaultHeterogeneousAgentType('toString')).toBe(false);
    expect(getServerDefaultHeterogeneousAgentConfig(undefined)).toBeUndefined();
  });
});
