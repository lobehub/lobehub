import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as toolEngineering from '@/helpers/toolEngineering';
import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';
import { useToolStore } from '@/store/tool';

import { useChatStore } from '../../../../store';
import {
  createMockAgentConfig,
  createMockChatConfig,
  createMockMessage,
  TEST_IDS,
} from './fixtures';
import { resetTestEnvironment } from './helpers';

const discoverableTool = {
  identifier: 'test-discoverable',
  manifest: {
    api: [{ description: 'run', name: 'run', parameters: {} }],
    identifier: 'test-discoverable',
    meta: {},
    type: 'builtin',
  },
  type: 'builtin',
} as any;

describe('internal_createAgentState manifest map', () => {
  beforeEach(() => {
    resetTestEnvironment();
    vi.spyOn(agentConfigResolver, 'resolveAgentConfig').mockReturnValue({
      agentConfig: createMockAgentConfig(),
      chatConfig: createMockChatConfig(),
      isBuiltinAgent: false,
      plugins: [],
    });
    vi.spyOn(toolEngineering, 'createAgentToolsEngine').mockReturnValue({
      generateToolsDetailed: vi
        .fn()
        .mockReturnValue({ enabledManifests: [], enabledToolIds: [], tools: [] }),
    } as any);
    act(() => {
      useToolStore.setState({ builtinTools: [discoverableTool] });
    });
  });

  it('carries discoverable manifests so a tool activated mid-run keeps its own approval policy', () => {
    const { state } = useChatStore.getState().internal_createAgentState({
      agentId: TEST_IDS.SESSION_ID,
      messages: [createMockMessage()],
      parentMessageId: TEST_IDS.USER_MESSAGE_ID,
      topicId: TEST_IDS.TOPIC_ID,
    });

    expect(state.operationToolSet?.manifestMap['test-discoverable']).toBeDefined();
    expect(state.operationToolSet?.enabledToolIds).not.toContain('test-discoverable');
  });
});
