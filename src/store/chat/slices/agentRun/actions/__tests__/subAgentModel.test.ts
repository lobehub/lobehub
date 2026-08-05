import { DEFAULT_SUB_AGENT_MODEL, resolveSubAgentModel } from '@lobechat/const';
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
  it('falls back to the global default when the agent has no subagent config', () => {
    expect(resolveSubAgentModel(undefined)).toEqual({
      model: DEFAULT_SUB_AGENT_MODEL,
      provider: 'deepseek',
    });
  });

  it('uses the configured override', () => {
    expect(resolveSubAgentModel({ model: 'gpt-5.4', provider: 'openai' })).toEqual({
      model: 'gpt-5.4',
      provider: 'openai',
    });
  });

  it('ignores a provider-only config rather than pairing it with a foreign model', () => {
    expect(resolveSubAgentModel({ provider: 'openai' })).toEqual({
      model: DEFAULT_SUB_AGENT_MODEL,
      provider: 'deepseek',
    });
  });
});
