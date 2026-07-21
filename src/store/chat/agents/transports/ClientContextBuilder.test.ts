import { AgentRuntime } from '@lobechat/agent-runtime';
import type { ToolsEngine } from '@lobechat/context-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { chatService } from '@/services/chat';
import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import type { ChatStore } from '@/store/chat/store';

import { ClientContextBuilder } from './ClientContextBuilder';

describe('ClientContextBuilder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prepares context once and resolves step-activated tools for the LLM transport', async () => {
    const activatedManifest = {
      api: [{ description: 'Search', name: 'search', parameters: {} }],
      identifier: 'dynamic-search',
      meta: { title: 'Search' },
      type: 'builtin' as const,
    };
    const activatedTool = {
      function: {
        description: 'Search',
        name: 'dynamic-search____search',
        parameters: {},
      },
      type: 'function' as const,
    };
    const toolsEngine = {
      generateToolsDetailed: vi.fn().mockReturnValue({
        enabledManifests: [activatedManifest],
        enabledToolIds: [activatedManifest.identifier],
        filteredTools: [],
        tools: [activatedTool],
      }),
    } as unknown as ToolsEngine;
    const agentConfig: ResolvedAgentConfig = {
      agentConfig: {
        ...DEFAULT_AGENT_CONFIG,
        model: 'test-model',
        provider: 'test-provider',
      },
      chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG },
      enabledManifests: [],
      enabledToolIds: [],
      isBuiltinAgent: false,
      plugins: [],
      tools: [],
    };
    const store = {
      operations: {
        'operation-1': {
          context: { agentId: 'agent-1', topicId: 'topic-1' },
          metadata: { traceId: 'trace-1' },
        },
      },
    } as unknown as ChatStore;
    const prepareContext = vi
      .spyOn(chatService, 'buildAssistantMessageContext')
      .mockImplementation(async ({ messages, resolvedAgentConfig }) => ({
        options: {},
        params: {
          messages: messages as any,
          model: 'test-model',
          provider: 'test-provider',
          tools: resolvedAgentConfig.tools,
        },
      }));
    const builder = new ClientContextBuilder({
      agentConfig,
      get: () => store,
      operationId: 'operation-1',
      runtimeContext: {
        payload: {},
        phase: 'init',
        session: {
          messageCount: 1,
          sessionId: 'session-1',
          status: 'running',
          stepCount: 1,
        },
        stepContext: { activatedToolIds: ['dynamic-search'] },
      },
      toolsEngine,
    });
    const userMessage = { content: 'Question', id: 'user-1', role: 'user' as const };
    const assistantMessage = { content: '', id: 'assistant-1', role: 'assistant' as const };
    const state = AgentRuntime.createInitialState({
      messages: [userMessage],
      operationId: 'operation-1',
      operationToolSet: {
        enabledToolIds: [],
        manifestMap: {},
        sourceMap: {},
        tools: [],
      },
    });

    const result = await builder.build({
      model: 'test-model',
      payload: {
        assistantMessageId: assistantMessage.id,
        messages: [userMessage, assistantMessage],
        model: 'test-model',
        provider: 'test-provider',
        tools: [],
      } as any,
      provider: 'test-provider',
      state,
    });

    expect(toolsEngine.generateToolsDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ toolIds: ['dynamic-search'] }),
    );
    expect(prepareContext).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [userMessage],
        resolvedAgentConfig: expect.objectContaining({
          enabledToolIds: ['dynamic-search'],
          tools: [activatedTool],
        }),
      }),
      expect.any(Object),
    );
    expect(result.resolvedTools).toMatchObject({
      enabledToolIds: ['dynamic-search'],
      tools: [activatedTool],
    });
    expect(result.modelParameters).toMatchObject({
      params: { model: 'test-model', provider: 'test-provider', tools: [activatedTool] },
    });
  });
});
