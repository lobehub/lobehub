import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  DEFAULT_SUB_AGENT_MODEL,
  getSubAgentChatConfigOverride,
  resolveSubAgentChatConfig,
  resolveSubAgentModel,
} from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';

import { useChatStore } from '../../../../store';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockMessage,
  TEST_IDS,
} from './fixtures';
import { resetTestEnvironment } from './helpers';

/**
 * The model a `callSubAgent` sub-agent runs on is resolved at the *spawn site*
 * and handed to the run as an explicit override. It must not be re-derived from
 * `isSubAgent`: isolated group members carry that flag too (it disables the
 * lobe-agent tool) and have to keep the model configured on the member agent.
 */
describe('sub-agent model resolution', () => {
  const OWN = { model: 'gpt-5.4', provider: 'openai' };

  const createAgentState = (params: {
    isSubAgent?: boolean;
    modelOverride?: { model: string; provider: string };
  }) =>
    useChatStore.getState().internal_createAgentState({
      agentId: TEST_IDS.SESSION_ID,
      messages: [createMockMessage()],
      parentMessageId: TEST_IDS.USER_MESSAGE_ID,
      topicId: TEST_IDS.TOPIC_ID,
      ...params,
    });

  beforeEach(() => {
    resetTestEnvironment();
    vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
      agentConfig: createMockAgentConfig(OWN),
      chatConfig: createMockChatConfig(),
      isBuiltinAgent: false,
      plugins: [],
    });
  });

  it('runs a spawned sub-agent on the model the spawn site resolved', () => {
    const { agentConfig } = createAgentState({
      isSubAgent: true,
      modelOverride: { model: DEFAULT_SUB_AGENT_MODEL, provider: 'deepseek' },
    });

    expect(agentConfig.agentConfig).toMatchObject({
      model: DEFAULT_SUB_AGENT_MODEL,
      provider: 'deepseek',
    });
  });

  it('keeps a group member on its own model — isSubAgent alone must not override it', () => {
    const { agentConfig } = createAgentState({ isSubAgent: true });

    expect(agentConfig.agentConfig).toMatchObject(OWN);
  });

  it('keeps an ordinary run on its own model', () => {
    const { agentConfig } = createAgentState({});

    expect(agentConfig.agentConfig).toMatchObject(OWN);
  });
});

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
      model: DEFAULT_SUB_AGENT_MODEL,
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
