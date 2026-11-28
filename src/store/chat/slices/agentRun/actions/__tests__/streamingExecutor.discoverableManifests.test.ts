import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as toolEngineering from '@/helpers/toolEngineering';
import * as agentConfigResolver from '@/services/chat/mecha/agentConfigResolver';
import { useAgentStore } from '@/store/agent';
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

const initialAgentState = useAgentStore.getState();
const initialToolState = useToolStore.getState();

afterEach(() => {
  vi.restoreAllMocks();
  useAgentStore.setState(initialAgentState);
  useToolStore.setState(initialToolState);
});

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
      getAllPluginManifests: () =>
        new Map([[discoverableTool.identifier, discoverableTool.manifest]]),
      generateToolsDetailed: vi
        .fn()
        .mockReturnValue({ enabledManifests: [], enabledToolIds: ['lobe-activator'], tools: [] }),
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

describe('connectors on the executing client agent', () => {
  const ids = ['target-connector', 'parent-connector', 'new-connector'];
  beforeEach(() => {
    resetTestEnvironment();
    useAgentStore.setState({
      activeAgentId: 'parent',
      agentMap: {
        parent: createMockAgentConfig({
          plugins: ['parent-connector', { identifier: 'target-connector', mode: 'disabled' }],
        }),
      },
    });
    useToolStore.setState({
      installedPlugins: ids.map((identifier) => ({
        identifier,
        manifest: {
          api: [
            { description: 'Read', name: 'read', parameters: { properties: {}, type: 'object' } },
          ],
          identifier,
          meta: { title: identifier },
          type: 'default',
        },
        type: 'plugin',
      })),
    });
  });

  const startTarget = (toolMode: 'agent' | 'custom', pinned: string[] = []) => {
    const chatConfig = createMockChatConfig({ toolMode });
    const agentConfig = createMockAgentConfig({
      chatConfig,
      plugins: [
        ...pinned,
        { identifier: ids[0], mode: 'auto' },
        { identifier: ids[1], mode: 'disabled' },
      ],
    });
    useAgentStore.setState((s) => ({ agentMap: { ...s.agentMap, target: agentConfig } }));
    return useChatStore.getState().internal_createAgentState({
      agentId: 'parent',
      messages: [createMockMessage()],
      parentMessageId: TEST_IDS.USER_MESSAGE_ID,
      subAgentId: 'target',
    });
  };

  it.each(['agent', 'custom'] as const)(
    'applies the target’s overrides and %s mode when activating connectors',
    (mode) => {
      const run = startTarget(mode, mode === 'custom' ? ['lobe-activator'] : []);
      expect(run.agentConfig.enabledToolIds).toContain('lobe-activator');
      for (const id of ids) expect(run.agentConfig.enabledToolIds).not.toContain(id);
      const activated = run.toolsEngine.generateToolsDetailed({
        context: { isExplicitActivation: true },
        model: run.agentConfig.agentConfig.model,
        provider: run.agentConfig.agentConfig.provider!,
        skipDefaultTools: true,
        toolIds: ids,
      });
      expect(activated.tools?.map((tool) => tool.function.name)).toEqual([
        'target-connector____read',
        ...(mode === 'agent' ? ['new-connector____read'] : []),
      ]);
    },
  );

  it('offers the target’s connector up front in custom mode without an activator', () => {
    const run = startTarget('custom');
    expect(run.agentConfig.tools?.map((tool) => tool.function.name)).toEqual([
      'target-connector____read',
    ]);
  });
});
