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
        preserveThinking: true,
        replayAssistantReasoning: true,
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
    const additionalContexts = [
      {
        content: { text: 'Inspect the question.', type: 'text' as const },
        placement: 'stable_prefix' as const,
        wrapper: { tag: 'inspection' },
      },
    ];
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
        additionalContexts,
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
        discoveryExcludedToolIds: [],
        messages: [userMessage],
        resolvedAgentConfig: expect.objectContaining({
          enabledToolIds: ['dynamic-search'],
          tools: [activatedTool],
        }),
        additionalContexts,
      }),
      expect.any(Object),
    );
    expect(result.resolvedTools).toMatchObject({
      enabledToolIds: ['dynamic-search'],
      tools: [activatedTool],
    });
    expect(result.modelParameters).toMatchObject({
      params: {
        model: 'test-model',
        preserveThinking: true,
        provider: 'test-provider',
        tools: [activatedTool],
      },
    });
    expect(result.replayAssistantReasoning).toBe(true);
    expect(
      (result.modelParameters as { params: Record<string, unknown> }).params,
    ).not.toHaveProperty('additionalContexts');
  });

  it('promotes a deferred tool to its full manifest once it is activated', async () => {
    const api = (name: string) => ({ description: name, name, parameters: {} });
    const tool = (name: string) => ({
      function: { description: name, name: `lobe-skills____${name}`, parameters: {} },
      type: 'function' as const,
    });
    const shellManifest = {
      api: [api('runCommand')],
      identifier: 'lobe-skills',
      meta: { title: 'Skills' },
      systemRole: 'shell only',
      type: 'builtin' as const,
    };
    const fullManifest = {
      ...shellManifest,
      api: [api('activateSkill'), api('runCommand')],
      systemRole: 'full',
    };
    const otherManifest = { ...shellManifest, identifier: 'other-tool', systemRole: 'other' };
    const toolsEngine = {
      generateToolsDetailed: vi.fn().mockReturnValue({
        enabledManifests: [fullManifest],
        enabledToolIds: ['lobe-skills'],
        filteredTools: [],
        tools: [tool('activateSkill'), tool('runCommand')],
      }),
    } as unknown as ToolsEngine;
    const agentConfig: ResolvedAgentConfig = {
      agentConfig: { ...DEFAULT_AGENT_CONFIG, model: 'test-model', provider: 'test-provider' },
      chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG },
      enabledManifests: [shellManifest, otherManifest],
      enabledToolIds: ['lobe-skills', 'other-tool'],
      isBuiltinAgent: false,
      plugins: [],
      tools: [tool('runCommand')],
    };
    const store = {
      operations: { 'operation-1': { context: { agentId: 'agent-1' }, metadata: {} } },
    } as unknown as ChatStore;
    const prepareContext = vi
      .spyOn(chatService, 'buildAssistantMessageContext')
      .mockImplementation(async ({ messages }) => ({
        options: {},
        params: { messages: messages as any, model: 'test-model', provider: 'test-provider' },
      }));
    const builder = new ClientContextBuilder({
      agentConfig,
      get: () => store,
      operationId: 'operation-1',
      toolsEngine,
    });
    const userMessage = { content: 'Install it', id: 'user-1', role: 'user' as const };
    const state = {
      ...AgentRuntime.createInitialState({
        messages: [userMessage],
        operationId: 'operation-1',
        operationToolSet: {
          deferredManifestMap: { 'lobe-skills': fullManifest },
          enabledToolIds: ['lobe-skills', 'other-tool'],
          manifestMap: { 'lobe-skills': shellManifest, 'other-tool': otherManifest },
          sourceMap: {},
          tools: [tool('runCommand')],
        },
      }),
      activatedStepTools: [
        { activatedAtStep: 1, id: 'lobe-skills', manifest: fullManifest, source: 'discovery' },
      ],
    };

    await builder.build({
      model: 'test-model',
      payload: { messages: [userMessage], model: 'test-model', provider: 'test-provider' } as any,
      provider: 'test-provider',
      state: state as any,
    });

    const { resolvedAgentConfig } = prepareContext.mock.calls[0][0];
    // The full manifest takes the narrowed one's place, in the same position.
    expect(resolvedAgentConfig?.enabledManifests).toEqual([fullManifest, otherManifest]);
    expect(resolvedAgentConfig?.tools?.map((item) => item.function.name)).toEqual([
      'lobe-skills____runCommand',
      'lobe-skills____activateSkill',
    ]);
  });
});
