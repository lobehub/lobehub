import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  getSubAgentChatConfigOverride,
  resolveSubAgentChatConfig,
  resolveSubAgentModel,
} from '@lobechat/const';
import { describe, expect, it } from 'vitest';

describe('resolveSubAgentModel', () => {
  const PARENT = { model: 'claude-sonnet-5', provider: 'anthropic' };

  it('follows the parent effective model when the agent has no subagent config', () => {
    expect(resolveSubAgentModel(undefined, PARENT)).toEqual(PARENT);
  });

  it('follows the parent after the override was cleared (nulled) in settings', () => {
    expect(resolveSubAgentModel({ model: null, provider: null }, PARENT)).toEqual(PARENT);
  });

  it('prefers the configured override over the parent model', () => {
    expect(resolveSubAgentModel({ model: 'gpt-5.4', provider: 'openai' }, PARENT)).toEqual({
      model: 'gpt-5.4',
      provider: 'openai',
    });
  });

  it('falls back to the global default when no override and no parent model exist', () => {
    expect(resolveSubAgentModel(undefined)).toEqual({
      model: DEFAULT_MODEL,
      provider: DEFAULT_PROVIDER,
    });
  });

  it('pairs a provider-less parent model with the default provider, not a foreign one', () => {
    // e.g. a legacy topic-pinned model whose provider column is empty
    expect(resolveSubAgentModel(undefined, { model: 'gpt-5.4', provider: '' })).toEqual({
      model: 'gpt-5.4',
      provider: DEFAULT_PROVIDER,
    });
  });

  it('ignores a provider-only config rather than pairing it with a foreign model', () => {
    expect(resolveSubAgentModel({ provider: 'openai' }, PARENT)).toEqual(PARENT);
  });
});

describe('getSubAgentChatConfigOverride', () => {
  const CHAT_CONFIG = { thinkingLevel: 'low' } as any;

  it('forwards the chatConfig while an explicit sub-agent model is configured', () => {
    expect(getSubAgentChatConfigOverride({ chatConfig: CHAT_CONFIG, model: 'gpt-5.4' })).toEqual(
      CHAT_CONFIG,
    );
  });

  it('drops a stale chatConfig once the model override is cleared or absent', () => {
    // A follow-parent sub-agent must not silently keep old thinking overrides.
    expect(getSubAgentChatConfigOverride({ chatConfig: CHAT_CONFIG, model: null })).toBeUndefined();
    expect(getSubAgentChatConfigOverride({ chatConfig: CHAT_CONFIG })).toBeUndefined();
    expect(getSubAgentChatConfigOverride(undefined)).toBeUndefined();
  });
});

describe('resolveSubAgentChatConfig', () => {
  const PARENT_CHAT_CONFIG = { enableReasoning: true, thinkingLevel: 'high' };

  it('returns the parent chatConfig untouched when there is no override', () => {
    expect(resolveSubAgentChatConfig(PARENT_CHAT_CONFIG, undefined)).toBe(PARENT_CHAT_CONFIG);
    expect(resolveSubAgentChatConfig(PARENT_CHAT_CONFIG, null)).toBe(PARENT_CHAT_CONFIG);
  });

  it('merges override keys over the parent chatConfig', () => {
    expect(resolveSubAgentChatConfig(PARENT_CHAT_CONFIG, { thinkingLevel: 'minimal' })).toEqual({
      enableReasoning: true,
      thinkingLevel: 'minimal',
    });
  });

  it('skips nulled override keys so they fall back to the parent value', () => {
    expect(
      resolveSubAgentChatConfig(PARENT_CHAT_CONFIG, {
        enableReasoning: null as unknown as boolean,
        thinkingLevel: 'low',
      }),
    ).toEqual({ enableReasoning: true, thinkingLevel: 'low' });
  });

  it('builds a config from the override alone when the parent has none', () => {
    expect(resolveSubAgentChatConfig(undefined, { thinkingLevel: 'low' })).toEqual({
      thinkingLevel: 'low',
    });
  });
});
