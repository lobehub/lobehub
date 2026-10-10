import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentHookConfig } from '../agentHook';

beforeEach(() => {
  for (const name of ['URL', 'TOKEN', 'EVENTS', 'RESPONSE_HANDLING', 'ON_ERROR'])
    vi.stubEnv(`AGENT_HOOK_WEBHOOK_${name}`, undefined);
});
afterEach(() => vi.unstubAllEnvs());

const enable = () => {
  vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'http://webhook-service/ingress');
  vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-env-secret');
  vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'beforeToolCall, afterToolCall, onToolCallError');
};

describe('server hook environment', () => {
  it('is disabled by default', () => {
    expect(getAgentHookConfig().AGENT_HOOK_WEBHOOK_URL).toBeUndefined();
  });

  it('normalizes and validates existing event names with notification defaults', () => {
    enable();
    vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', ' beforeToolCall, ,afterToolCall,beforeToolCall, ');
    expect(getAgentHookConfig()).toMatchObject({
      AGENT_HOOK_WEBHOOK_EVENTS: ['beforeToolCall', 'afterToolCall'],
      AGENT_HOOK_WEBHOOK_ON_ERROR: 'continue',
      AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING: 'ignore',
      AGENT_HOOK_WEBHOOK_URL: 'http://webhook-service/ingress',
    });
  });

  it.each([
    ['TOKEN', undefined],
    ['TOKEN', '   '],
    ['EVENTS', undefined],
    ['EVENTS', ' , , '],
    ['EVENTS', 'beforeToolCall,...'],
    ['EVENTS', 'onUserPrompt'],
    ['URL', 'ftp://webhook-service/ingress'],
    ['URL', ''],
    ['RESPONSE_HANDLING', 'invalid'],
    ['RESPONSE_HANDLING', 'toolResult'],
    ['RESPONSE_HANDLING', 'toolCallAndResult'],
    ['ON_ERROR', 'invalid'],
    ['ON_ERROR', 'block'],
  ])('rejects invalid %s without exposing the token', (name, value) => {
    enable();
    vi.stubEnv(`AGENT_HOOK_WEBHOOK_${name}`, value);
    let error: unknown;
    try {
      getAgentHookConfig();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('AGENT_HOOK_WEBHOOK');
    expect(String(error)).not.toContain('synthetic-env-secret');
  });

  it('accepts afterToolCall-only result controls', () => {
    enable();
    vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
    expect(getAgentHookConfig().AGENT_HOOK_WEBHOOK_EVENTS).toEqual(['afterToolCall']);
  });

  it('requires a beforeToolCall or afterToolCall event for toolCall', () => {
    enable();
    vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'onToolCallError');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
    expect(() => getAgentHookConfig()).toThrow('beforeToolCall');
  });
});
