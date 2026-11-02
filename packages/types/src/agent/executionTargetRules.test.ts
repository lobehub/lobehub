import { describe, expect, it } from 'vitest';

import { AgentChatConfigSchema } from './chatConfig';
import { resolveContextMode, resolveToolMode } from './executionTargetRules';

describe('resolveToolMode', () => {
  it.each([
    [undefined, 'agent'],
    [{}, 'agent'],
    [{ enableAgentMode: true }, 'agent'],
    [{ enableAgentMode: false }, 'chat'],
    [{ enableAgentMode: true, toolMode: 'chat' }, 'chat'],
    [{ enableAgentMode: false, toolMode: 'agent' }, 'agent'],
    [{ enableAgentMode: true, toolMode: 'custom' }, 'custom'],
  ] as const)('preserves the existing tri-state for %j', (chatConfig, expected) => {
    expect(resolveToolMode(chatConfig)).toBe(expected);
  });
});

describe('resolveContextMode', () => {
  it('defaults omitted or explicit default configs to default', () => {
    expect(resolveContextMode(undefined, { supportToolUse: true })).toBe('default');
    expect(resolveContextMode({}, { supportToolUse: true })).toBe('default');
    expect(
      resolveContextMode(
        { contextMode: 'default', enableAgentMode: true },
        { supportToolUse: true },
      ),
    ).toBe('default');
  });

  it('enables on-demand only for explicit on-demand + agent + function calling', () => {
    expect(
      resolveContextMode(
        { contextMode: 'on-demand', enableAgentMode: true, toolMode: 'agent' },
        { supportToolUse: true },
      ),
    ).toBe('on-demand');
  });

  it.each([
    [{ contextMode: 'on-demand' as const, enableAgentMode: false }, true],
    [{ contextMode: 'on-demand' as const, enableAgentMode: true, toolMode: 'chat' as const }, true],
    [
      {
        contextMode: 'on-demand' as const,
        enableAgentMode: true,
        toolMode: 'custom' as const,
      },
      true,
    ],
    [{ contextMode: 'on-demand' as const, enableAgentMode: true }, false],
  ] as const)('falls back for unsafe combination %j (support=%s)', (chatConfig, supportToolUse) => {
    expect(resolveContextMode(chatConfig, { supportToolUse })).toBe('default');
  });

  it('never lets contextMode change the legacy tool mode', () => {
    const chatConfig = {
      contextMode: 'on-demand' as const,
      enableAgentMode: false,
      toolMode: 'agent' as const,
    };

    expect(resolveToolMode(chatConfig)).toBe('agent');
    expect(resolveContextMode(chatConfig, { supportToolUse: true })).toBe('on-demand');
  });
});

describe('AgentChatConfigSchema contextMode', () => {
  it('accepts the new option and leaves it absent by default', () => {
    expect(AgentChatConfigSchema.parse({})).not.toHaveProperty('contextMode');
    expect(AgentChatConfigSchema.parse({ contextMode: 'default' }).contextMode).toBe('default');
    expect(AgentChatConfigSchema.parse({ contextMode: 'on-demand' }).contextMode).toBe('on-demand');
  });

  it('rejects unknown context modes', () => {
    expect(() => AgentChatConfigSchema.parse({ contextMode: 'efficient' })).toThrow();
  });
});
