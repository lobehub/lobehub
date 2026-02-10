import { type ChatToolPayload, type GlobalInterventionAuditConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

describe('GeneralChatAgent', () => {
  const mockModelRuntimeConfig = {
    model: 'gpt-4o-mini',
    provider: 'openai',
  };

  const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
    operationId: 'test-session',
    status: 'running',
    messages: [],
    toolManifestMap: {},
    stepCount: 0,
    usage: {
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { totalCalls: 0, totalTimeMs: 0, byTool: [] },
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
    },
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    ...overrides,
  });

  const createMockContext = (
    phase: AgentRuntimeContext['phase'],
    payload?: any,
  ): AgentRuntimeContext => ({
    phase,
    payload,
    session: {
      // Note: AgentRuntimeContext.session uses sessionId for backward compatibility
      sessionId: 'test-session',
      messageCount: 0,
      status: 'running',
      stepCount: 0,
    },
  });

  describe('init and user_input phase', () => {
    it('should return call_llm instruction for init phase', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [{ role: 'user', content: 'Hello' }] as any,
      });
      const context = createMockContext('init', { model: 'gpt-4o-mini', provider: 'openai' });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          model: 'gpt-4o-mini',
          provider: 'openai',
        },
      });
    });

    it('should return call_llm instruction for user_input phase', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [{ role: 'user', content: 'What is the weather?' }] as any,
      });
      const context = createMockContext('user_input', {
        message: { role: 'user', content: 'What is the weather?' },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          message: { role: 'user', content: 'What is the weather?' },
        },
      });
    });
  });

  describe('llm_result phase', () => {
    it('should return finish when no tool calls', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('llm_result', {
        hasToolsCalling: false,
        toolsCalling: [],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'completed',
        reasonDetail: 'LLM response completed without tool calls',
      });
    });

    it('should return call_tool for single tool that does not need intervention', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'test-plugin',
        apiName: 'test-api',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'test-plugin': {
            identifier: 'test-plugin',
            // No humanIntervention config = no intervention needed
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: toolCall,
          },
        },
      ]);
    });

    it('should return call_tools_batch for multiple tools that do not need intervention', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCalls: ChatToolPayload[] = [
        {
          id: 'call-1',
          identifier: 'plugin-1',
          apiName: 'api-1',
          arguments: '{}',
          type: 'default',
        },
        {
          id: 'call-2',
          identifier: 'plugin-2',
          apiName: 'api-2',
          arguments: '{}',
          type: 'default',
        },
      ];

      const state = createMockState({
        toolManifestMap: {
          'plugin-1': { identifier: 'plugin-1' },
          'plugin-2': { identifier: 'plugin-2' },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: toolCalls,
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tools_batch',
          payload: {
            parentMessageId: 'msg-1',
            toolsCalling: toolCalls,
          },
        },
      ]);
    });

    it('should handle invalid JSON in tool arguments gracefully', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'test-plugin',
        apiName: 'test-api',
        arguments: '{invalid json}', // Invalid JSON
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'test-plugin': {
            identifier: 'test-plugin',
            // No humanIntervention config
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      // Should not throw, should proceed with call_tool (treats invalid JSON as empty args)
      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: toolCall,
          },
        },
      ]);
    });

    it('should return request_human_approve for tools requiring intervention', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'dangerous-plugin',
        apiName: 'delete-api',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'dangerous-plugin': {
            identifier: 'dangerous-plugin',
            humanIntervention: 'require', // Always require approval
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should return both call_tools_batch and request_human_approve for mixed tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const safeTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'safe-plugin',
        apiName: 'read-api',
        arguments: '{}',
        type: 'default',
      };

      const dangerousTool: ChatToolPayload = {
        id: 'call-2',
        identifier: 'dangerous-plugin',
        apiName: 'delete-api',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'safe-plugin': {
            identifier: 'safe-plugin',
            // No intervention
          },
          'dangerous-plugin': {
            identifier: 'dangerous-plugin',
            humanIntervention: 'require',
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [safeTool, dangerousTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: safeTool,
          },
        },
        {
          type: 'request_human_approve',
          pendingToolsCalling: [dangerousTool],
          reason: 'human_intervention_required',
        },
      ]);
    });
  });

  describe('tool_result phase', () => {
    describe('GTD async tasks', () => {
      it('should return exec_task for single async task (execTask)', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState();
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: true,
          data: {
            state: {
              type: 'execTask',
              parentMessageId: 'exec-parent-msg',
              task: { instruction: 'Do something async', timeout: 30000 },
            },
          },
        });

        const result = await agent.runner(context, state);

        expect(result).toEqual({
          type: 'exec_task',
          payload: {
            parentMessageId: 'exec-parent-msg',
            task: { instruction: 'Do something async', timeout: 30000 },
          },
        });
      });

      it('should return exec_tasks for multiple async tasks (execTasks)', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState();
        const tasks = [
          { instruction: 'Task 1', timeout: 30000 },
          { instruction: 'Task 2', timeout: 30000 },
        ];
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: true,
          data: {
            state: {
              type: 'execTasks',
              parentMessageId: 'exec-parent-msg',
              tasks,
            },
          },
        });

        const result = await agent.runner(context, state);

        expect(result).toEqual({
          type: 'exec_tasks',
          payload: {
            parentMessageId: 'exec-parent-msg',
            tasks,
          },
        });
      });

      it('should return exec_client_task for single client-side async task (execClientTask)', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState();
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: true,
          data: {
            state: {
              type: 'execClientTask',
              parentMessageId: 'exec-parent-msg',
              task: { type: 'localFile', path: '/path/to/file' },
            },
          },
        });

        const result = await agent.runner(context, state);

        expect(result).toEqual({
          type: 'exec_client_task',
          payload: {
            parentMessageId: 'exec-parent-msg',
            task: { type: 'localFile', path: '/path/to/file' },
          },
        });
      });

      it('should return exec_client_tasks for multiple client-side async tasks (execClientTasks)', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState();
        const tasks = [
          { type: 'localFile', path: '/path/to/file1' },
          { type: 'localFile', path: '/path/to/file2' },
        ];
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: true,
          data: {
            state: {
              type: 'execClientTasks',
              parentMessageId: 'exec-parent-msg',
              tasks,
            },
          },
        });

        const result = await agent.runner(context, state);

        expect(result).toEqual({
          type: 'exec_client_tasks',
          payload: {
            parentMessageId: 'exec-parent-msg',
            tasks,
          },
        });
      });

      it('should not trigger exec_task when stop is false', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState({
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: '' },
            { role: 'tool', content: 'Result', tool_call_id: 'call-1' },
          ] as any,
        });
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: false, // stop is false, should not trigger exec_task
          data: {
            state: {
              type: 'execTask',
              parentMessageId: 'exec-parent-msg',
              task: { instruction: 'Do something async' },
            },
          },
        });

        const result = await agent.runner(context, state);

        // Should return call_llm instead of exec_task
        expect(result).toEqual({
          type: 'call_llm',
          payload: {
            messages: state.messages,
            model: 'gpt-4o-mini',
            parentMessageId: 'tool-msg-1',
            provider: 'openai',
            tools: undefined,
          },
        });
      });

      it('should not trigger exec_task when data.state is undefined', async () => {
        const agent = new GeneralChatAgent({
          agentConfig: { maxSteps: 100 },
          operationId: 'test-session',
          modelRuntimeConfig: mockModelRuntimeConfig,
        });

        const state = createMockState({
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: '' },
            { role: 'tool', content: 'Result', tool_call_id: 'call-1' },
          ] as any,
        });
        const context = createMockContext('tool_result', {
          parentMessageId: 'tool-msg-1',
          stop: true,
          data: {}, // No state property
        });

        const result = await agent.runner(context, state);

        // Should return call_llm instead of exec_task
        expect(result).toEqual({
          type: 'call_llm',
          payload: {
            messages: state.messages,
            model: 'gpt-4o-mini',
            parentMessageId: 'tool-msg-1',
            provider: 'openai',
            tools: undefined,
          },
        });
      });
    });

    it('should return call_llm when no pending tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: '', tools: [] },
          { role: 'tool', content: 'Result', tool_call_id: 'call-1' },
        ] as any,
      });

      const context = createMockContext('tool_result', {
        parentMessageId: 'tool-msg-1',
        result: { data: 'result' },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          model: 'gpt-4o-mini',
          parentMessageId: 'tool-msg-1',
          provider: 'openai',
          tools: undefined,
        },
      });
    });

    it('should return request_human_approve when there are pending tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const pendingPlugin: ChatToolPayload = {
        id: 'call-2',
        identifier: 'plugin-2',
        apiName: 'api-2',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: '', tools: [] },
          { role: 'tool', content: 'Result', tool_call_id: 'call-1' },
          {
            role: 'tool',
            content: '',
            tool_call_id: 'call-2',
            plugin: pendingPlugin,
            pluginIntervention: { status: 'pending' },
          },
        ] as any,
      });

      const context = createMockContext('tool_result', {
        parentMessageId: 'tool-msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'request_human_approve',
        pendingToolsCalling: [pendingPlugin],
        reason: 'Some tools still pending approval',
        skipCreateToolMessage: true,
      });
    });
  });

  describe('tools_batch_result phase', () => {
    it('should return call_llm when no pending tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: '', tools: [] },
          { role: 'tool', content: 'Result 1', tool_call_id: 'call-1' },
          { role: 'tool', content: 'Result 2', tool_call_id: 'call-2' },
        ] as any,
      });

      const context = createMockContext('tools_batch_result', {
        parentMessageId: 'tool-msg-2',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          model: 'gpt-4o-mini',
          parentMessageId: 'tool-msg-2',
          provider: 'openai',
          tools: undefined,
        },
      });
    });

    it('should return request_human_approve when there are pending tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const pendingPlugin: ChatToolPayload = {
        id: 'call-3',
        identifier: 'plugin-3',
        apiName: 'api-3',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: '', tools: [] },
          { role: 'tool', content: 'Result 1', tool_call_id: 'call-1' },
          { role: 'tool', content: 'Result 2', tool_call_id: 'call-2' },
          {
            role: 'tool',
            content: '',
            tool_call_id: 'call-3',
            plugin: pendingPlugin,
            pluginIntervention: { status: 'pending' },
          },
        ] as any,
      });

      const context = createMockContext('tools_batch_result', {
        parentMessageId: 'tool-msg-2',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'request_human_approve',
        pendingToolsCalling: [pendingPlugin],
        reason: 'Some tools still pending approval',
        skipCreateToolMessage: true,
      });
    });
  });

  describe('error phase', () => {
    it('should return finish instruction with error details', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const errorMessage = 'Network timeout';
      const context = createMockContext('error', {
        error: new Error(errorMessage),
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'error_recovery',
        reasonDetail: errorMessage,
      });
    });

    it('should handle error without message', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('error', { error: {} });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'error_recovery',
        reasonDetail: 'Unknown error occurred',
      });
    });
  });

  describe('unified abort check', () => {
    it('should handle abort at llm_result phase when state is interrupted', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCalls: ChatToolPayload[] = [
        {
          apiName: 'search',
          arguments: '{"query":"test"}',
          id: 'call-1',
          identifier: 'lobe-web-browsing',
          type: 'default',
        },
      ];

      const state = createMockState({
        status: 'interrupted', // State is interrupted
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: toolCalls,
        parentMessageId: 'msg-123',
      });

      const result = await agent.runner(context, state);

      // Should handle abort and return resolve_aborted_tools
      expect(result).toEqual({
        type: 'resolve_aborted_tools',
        payload: {
          parentMessageId: 'msg-123',
          toolsCalling: toolCalls,
        },
      });
    });

    it('should handle abort at tool_result phase when state is interrupted', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        status: 'interrupted',
        messages: [
          {
            id: 'tool-msg-1',
            role: 'tool',
            content: '',
            plugin: {
              id: 'call-1',
              identifier: 'bash',
              apiName: 'bash',
              arguments: '{"command":"ls"}',
              type: 'builtin',
            },
            pluginIntervention: { status: 'pending' },
          } as any,
        ],
      });

      const context = createMockContext('tool_result', {
        parentMessageId: 'msg-456',
      });

      const result = await agent.runner(context, state);

      // Should handle abort and resolve pending tools
      expect(result).toEqual({
        type: 'resolve_aborted_tools',
        payload: {
          parentMessageId: 'msg-456',
          toolsCalling: [
            {
              id: 'call-1',
              identifier: 'bash',
              apiName: 'bash',
              arguments: '{"command":"ls"}',
              type: 'builtin',
            },
          ],
        },
      });
    });

    it('should return finish when state is interrupted with no tools', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        status: 'interrupted',
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: false,
        toolsCalling: [],
        parentMessageId: 'msg-789',
      });

      const result = await agent.runner(context, state);

      // Should handle abort and return finish
      expect(result).toEqual({
        type: 'finish',
        reason: 'user_requested',
        reasonDetail: 'Operation cancelled by user',
      });
    });

    it('should continue normal flow when state is not interrupted', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCalls: ChatToolPayload[] = [
        {
          apiName: 'search',
          arguments: '{"query":"test"}',
          id: 'call-1',
          identifier: 'lobe-web-browsing',
          type: 'default',
        },
      ];

      const state = createMockState({
        status: 'running', // Normal running state
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: toolCalls,
        parentMessageId: 'msg-999',
      });

      const result = await agent.runner(context, state);

      // Should continue normal flow and execute tools
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-999',
            toolCalling: toolCalls[0],
          },
        },
      ]);
    });
  });

  describe('unified abort check', () => {
    it('should handle abort at human_abort phase when state is interrupted', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCalls: ChatToolPayload[] = [
        {
          apiName: 'search',
          arguments: '{"query":"test"}',
          id: 'call-1',
          identifier: 'lobe-web-browsing',
          type: 'default',
        },
      ];

      const state = createMockState({
        status: 'interrupted', // Trigger unified abort check
      });

      const context = createMockContext('human_abort', {
        reason: 'user_cancelled',
        parentMessageId: 'msg-123',
        hasToolsCalling: true,
        toolsCalling: toolCalls,
        result: { content: '', tool_calls: [] },
      });

      const result = await agent.runner(context, state);

      // Should handle abort via extractAbortInfo and return resolve_aborted_tools
      expect(result).toEqual({
        type: 'resolve_aborted_tools',
        payload: {
          parentMessageId: 'msg-123',
          toolsCalling: toolCalls,
        },
      });
    });
  });

  describe('human_abort phase', () => {
    it('should return resolve_aborted_tools when there are pending tool calls', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCalls: ChatToolPayload[] = [
        {
          apiName: 'search',
          arguments: '{"query":"test"}',
          id: 'call-1',
          identifier: 'lobe-web-browsing',
          type: 'default',
        },
        {
          apiName: 'getWeather',
          arguments: '{"location":"NYC"}',
          id: 'call-2',
          identifier: 'weather-plugin',
          type: 'default',
        },
      ];

      const state = createMockState();
      const context = createMockContext('human_abort', {
        reason: 'user_cancelled',
        parentMessageId: 'msg-123',
        hasToolsCalling: true,
        toolsCalling: toolCalls,
        result: { content: '', tool_calls: [] },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'resolve_aborted_tools',
        payload: {
          parentMessageId: 'msg-123',
          toolsCalling: toolCalls,
        },
      });
    });

    it('should return finish when there are no tool calls', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('human_abort', {
        reason: 'user_cancelled',
        parentMessageId: 'msg-123',
        hasToolsCalling: false,
        toolsCalling: [],
        result: { content: 'Hello', tool_calls: [] },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'user_requested',
        reasonDetail: 'user_cancelled',
      });
    });

    it('should return finish when toolsCalling is undefined', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('human_abort', {
        reason: 'operation_cancelled',
        parentMessageId: 'msg-456',
        hasToolsCalling: false,
        result: { content: 'Partial response', tool_calls: [] },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'user_requested',
        reasonDetail: 'operation_cancelled',
      });
    });

    it('should return finish when toolsCalling is empty array', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('human_abort', {
        reason: 'user_cancelled',
        parentMessageId: 'msg-789',
        hasToolsCalling: true,
        toolsCalling: [],
        result: { content: '', tool_calls: [] },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'user_requested',
        reasonDetail: 'user_cancelled',
      });
    });
  });

  describe('task_result phase (single task)', () => {
    it('should return call_llm when task completed', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Execute task' },
          { role: 'assistant', content: '' },
          { role: 'task', content: 'Task result', metadata: { instruction: 'Do task' } },
        ] as any,
      });

      const context = createMockContext('task_result', {
        parentMessageId: 'task-parent-msg',
        result: {
          success: true,
          taskMessageId: 'task-1',
          threadId: 'thread-1',
          result: 'Task result',
        },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          model: 'gpt-4o-mini',
          parentMessageId: 'task-parent-msg',
          provider: 'openai',
          tools: undefined,
        },
      });
    });

    it('should return call_llm even when task failed', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Execute task' },
          { role: 'assistant', content: '' },
          { role: 'task', content: 'Task failed: timeout', metadata: { instruction: 'Do task' } },
        ] as any,
      });

      const context = createMockContext('task_result', {
        parentMessageId: 'task-parent-msg',
        result: {
          success: false,
          taskMessageId: 'task-1',
          threadId: 'thread-1',
          error: 'Task timeout after 1800000ms',
        },
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: state.messages,
          model: 'gpt-4o-mini',
          parentMessageId: 'task-parent-msg',
          provider: 'openai',
          tools: undefined,
        },
      });
    });
  });

  describe('tasks_batch_result phase (multiple tasks)', () => {
    it('should return call_llm when tasks completed', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Execute tasks' },
          { role: 'assistant', content: '' },
          { role: 'task', content: 'Task 1 result', metadata: { instruction: 'Do task 1' } },
          { role: 'task', content: 'Task 2 result', metadata: { instruction: 'Do task 2' } },
        ] as any,
      });

      const context = createMockContext('tasks_batch_result', {
        parentMessageId: 'task-parent-msg',
        results: [
          { success: true, taskMessageId: 'task-1', threadId: 'thread-1', result: 'Task 1 result' },
          { success: true, taskMessageId: 'task-2', threadId: 'thread-2', result: 'Task 2 result' },
        ],
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: [
            ...state.messages,
            {
              content:
                'All tasks above have been completed. Please summarize the results or continue with your response following user query language.',
              role: 'user',
            },
          ],
          model: 'gpt-4o-mini',
          parentMessageId: 'task-parent-msg',
          provider: 'openai',
          tools: undefined,
        },
      });
    });

    it('should return call_llm even when some tasks failed', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState({
        messages: [
          { role: 'user', content: 'Execute tasks' },
          { role: 'assistant', content: '' },
          { role: 'task', content: 'Task 1 result', metadata: { instruction: 'Do task 1' } },
          { role: 'task', content: 'Task failed: timeout', metadata: { instruction: 'Do task 2' } },
        ] as any,
      });

      const context = createMockContext('tasks_batch_result', {
        parentMessageId: 'task-parent-msg',
        results: [
          { success: true, taskMessageId: 'task-1', threadId: 'thread-1', result: 'Task 1 result' },
          {
            success: false,
            taskMessageId: 'task-2',
            threadId: 'thread-2',
            error: 'Task timeout after 1800000ms',
          },
        ],
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'call_llm',
        payload: {
          messages: [
            ...state.messages,
            {
              content:
                'All tasks above have been completed. Please summarize the results or continue with your response following user query language.',
              role: 'user',
            },
          ],
          model: 'gpt-4o-mini',
          parentMessageId: 'task-parent-msg',
          provider: 'openai',
          tools: undefined,
        },
      });
    });
  });

  describe('unknown phase', () => {
    it('should return finish instruction for unknown phase', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const state = createMockState();
      const context = createMockContext('unknown_phase' as any);

      const result = await agent.runner(context, state);

      expect(result).toEqual({
        type: 'finish',
        reason: 'agent_decision',
        reasonDetail: 'Unknown phase: unknown_phase',
      });
    });
  });

  describe('intervention checking', () => {
    it('should require intervention when dynamic policy resolves to required', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        dynamicInterventionAudits: {
          pathScopeAudit: (toolArgs, metadata) => {
            const workingDirectory = metadata?.workingDirectory as string | undefined;
            if (!workingDirectory) return false;
            const path = toolArgs.path as string;
            return !path.startsWith(workingDirectory);
          },
        },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'local-system',
        apiName: 'readLocalFile',
        arguments: '{"path":"/etc/passwd"}',
        type: 'builtin',
      };

      const state = createMockState({
        metadata: { workingDirectory: '/workspace' },
        toolManifestMap: {
          'local-system': {
            identifier: 'local-system',
            api: [
              {
                name: 'readLocalFile',
                humanIntervention: {
                  dynamic: {
                    default: 'never',
                    policy: 'required',
                    type: 'pathScopeAudit',
                  },
                },
              },
            ],
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should execute tool when dynamic policy resolves to never', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        dynamicInterventionAudits: {
          pathScopeAudit: (toolArgs, metadata) => {
            const workingDirectory = metadata?.workingDirectory as string | undefined;
            if (!workingDirectory) return false;
            const path = toolArgs.path as string;
            return !path.startsWith(workingDirectory);
          },
        },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'local-system',
        apiName: 'readLocalFile',
        arguments: '{"path":"/workspace/README.md"}',
        type: 'builtin',
      };

      const state = createMockState({
        metadata: { workingDirectory: '/workspace' },
        toolManifestMap: {
          'local-system': {
            identifier: 'local-system',
            api: [
              {
                name: 'readLocalFile',
                humanIntervention: {
                  dynamic: {
                    default: 'never',
                    policy: 'required',
                    type: 'pathScopeAudit',
                  },
                },
              },
            ],
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: toolCall,
          },
        },
      ]);
    });

    it('should check intervention at API level when configured', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'plugin',
        apiName: 'dangerous-api',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          plugin: {
            identifier: 'plugin',
            // Tool-level config
            humanIntervention: 'never',
            api: [
              {
                name: 'safe-api',
                // Safe API
              },
              {
                name: 'dangerous-api',
                // API-level config overrides tool-level
                humanIntervention: 'require',
              },
            ],
          },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should require approval because API-level config overrides
      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should execute all tools when user approvalMode is auto-run', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'dangerous-tool',
        apiName: 'delete',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'dangerous-tool': {
            identifier: 'dangerous-tool',
            humanIntervention: 'required', // Tool requires approval
          },
        },
        userInterventionConfig: {
          approvalMode: 'auto-run', // But user config overrides
          allowList: [],
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute directly despite tool requiring approval
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: toolCall,
          },
        },
      ]);
    });

    it('should respect allowList when approvalMode is allow-list', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const allowedTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'bash',
        apiName: 'bash',
        arguments: '{"command":"ls"}',
        type: 'builtin',
      };

      const blockedTool: ChatToolPayload = {
        id: 'call-2',
        identifier: 'bash',
        apiName: 'dangerous-command',
        arguments: '{"command":"rm -rf"}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          bash: {
            identifier: 'bash',
            humanIntervention: 'never', // Tool doesn't require approval by default
          },
        },
        userInterventionConfig: {
          approvalMode: 'allow-list',
          allowList: ['bash/bash'], // Only bash/bash is allowed
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [allowedTool, blockedTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute allowed tool first, then request approval for blocked tool
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: allowedTool,
          },
        },
        {
          type: 'request_human_approve',
          pendingToolsCalling: [blockedTool],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should use tool config when approvalMode is manual', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const safeTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'web-search',
        apiName: 'search',
        arguments: '{}',
        type: 'default',
      };

      const dangerousTool: ChatToolPayload = {
        id: 'call-2',
        identifier: 'bash',
        apiName: 'bash',
        arguments: '{}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'web-search': {
            identifier: 'web-search',
            humanIntervention: 'never', // Safe tool
          },
          'bash': {
            identifier: 'bash',
            humanIntervention: 'required', // Dangerous tool
          },
        },
        userInterventionConfig: {
          approvalMode: 'manual', // Use tool's own config
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [safeTool, dangerousTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute safe tool, request approval for dangerous tool
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: safeTool,
          },
        },
        {
          type: 'request_human_approve',
          pendingToolsCalling: [dangerousTool],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should always require intervention for tools with "always" policy even in auto-run mode', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const alwaysTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'agent-builder',
        apiName: 'installPlugin',
        arguments: '{"identifier":"some-plugin","source":"market"}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'agent-builder': {
            identifier: 'agent-builder',
            api: [
              {
                name: 'installPlugin',
                humanIntervention: 'always', // Always requires intervention
              },
            ],
          },
        },
        userInterventionConfig: {
          approvalMode: 'auto-run', // User has auto-run enabled
          allowList: [],
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [alwaysTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should still require approval despite auto-run mode
      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [alwaysTool],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should always require intervention for tools with tool-level "always" policy', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const alwaysTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'sensitive-plugin',
        apiName: 'sensitiveAction',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'sensitive-plugin': {
            identifier: 'sensitive-plugin',
            humanIntervention: 'always', // Tool-level always policy
          },
        },
        userInterventionConfig: {
          approvalMode: 'auto-run',
          allowList: [],
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [alwaysTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should require approval despite auto-run mode
      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [alwaysTool],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should handle mixed tools with "always" and regular policies in auto-run mode', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const regularTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'web-search',
        apiName: 'search',
        arguments: '{}',
        type: 'default',
      };

      const alwaysTool: ChatToolPayload = {
        id: 'call-2',
        identifier: 'agent-builder',
        apiName: 'installPlugin',
        arguments: '{}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'web-search': {
            identifier: 'web-search',
            humanIntervention: 'required', // Would be bypassed by auto-run
          },
          'agent-builder': {
            identifier: 'agent-builder',
            api: [
              {
                name: 'installPlugin',
                humanIntervention: 'always', // Cannot be bypassed
              },
            ],
          },
        },
        userInterventionConfig: {
          approvalMode: 'auto-run',
          allowList: [],
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [regularTool, alwaysTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // regularTool should execute (auto-run), alwaysTool should require approval
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: regularTool,
          },
        },
        {
          type: 'request_human_approve',
          pendingToolsCalling: [alwaysTool],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should handle "always" policy with rule-based configuration', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'file-system',
        apiName: 'writeFile',
        arguments: '{"path":"/etc/passwd"}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'file-system': {
            identifier: 'file-system',
            api: [
              {
                name: 'writeFile',
                // Rule-based config with 'always' policy
                humanIntervention: [{ policy: 'always' }],
              },
            ],
          },
        },
        userInterventionConfig: {
          approvalMode: 'auto-run',
          allowList: [],
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should require approval due to 'always' rule
      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });
  });

  describe('global intervention resolvers', () => {
    it('should use custom global resolver with policy always to block tools', async () => {
      const customResolver: GlobalInterventionAuditConfig = {
        type: 'customBlocker',
        policy: 'always',
        resolver: (toolArgs) => toolArgs.dangerous === true,
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [customResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{"dangerous":true}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool', humanIntervention: 'never' },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should allow tool execution when global resolver does not trigger', async () => {
      const customResolver: GlobalInterventionAuditConfig = {
        type: 'customBlocker',
        policy: 'always',
        resolver: (toolArgs) => toolArgs.dangerous === true,
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [customResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{"dangerous":false}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool', humanIntervention: 'never' },
        },
        userInterventionConfig: { approvalMode: 'auto-run' },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: { parentMessageId: 'msg-1', toolCalling: toolCall },
        },
      ]);
    });

    it('should skip tool in headless mode when global resolver with policy always triggers', async () => {
      const customResolver: GlobalInterventionAuditConfig = {
        type: 'customBlocker',
        policy: 'always',
        resolver: (toolArgs) => toolArgs.blocked === true,
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [customResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const blockedTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{"blocked":true}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool' },
        },
        userInterventionConfig: { approvalMode: 'headless' },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [blockedTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Tool is skipped entirely in headless mode with 'always' policy
      expect(result).toEqual([]);
    });

    it('should execute tool in headless mode when global resolver with policy required triggers', async () => {
      const customResolver: GlobalInterventionAuditConfig = {
        type: 'softBlocker',
        policy: 'required',
        resolver: () => true, // always triggers
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [customResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool' },
        },
        userInterventionConfig: { approvalMode: 'headless' },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // 'required' policy is overridable → headless mode executes directly
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: { parentMessageId: 'msg-1', toolCalling: toolCall },
        },
      ]);
    });

    it('should require intervention for overridable global resolver in non-headless mode', async () => {
      const customResolver: GlobalInterventionAuditConfig = {
        type: 'softBlocker',
        policy: 'required',
        resolver: () => true,
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [customResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool', humanIntervention: 'never' },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [toolCall],
          reason: 'human_intervention_required',
        },
      ]);
    });

    it('should pass resolver metadata including securityBlacklist to global resolvers', async () => {
      let capturedMetadata: Record<string, any> | undefined;

      const spyResolver: GlobalInterventionAuditConfig = {
        type: 'spy',
        policy: 'always',
        resolver: (_toolArgs, metadata) => {
          capturedMetadata = metadata;
          return false;
        },
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [spyResolver],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        metadata: { workingDirectory: '/workspace' },
        toolManifestMap: {
          'my-tool': { identifier: 'my-tool', humanIntervention: 'never' },
        },
        userInterventionConfig: { approvalMode: 'auto-run' },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      await agent.runner(context, state);

      // Resolver should receive metadata with securityBlacklist merged in
      expect(capturedMetadata).toBeDefined();
      expect(capturedMetadata!.workingDirectory).toBe('/workspace');
      expect(capturedMetadata!.securityBlacklist).toBeDefined();
      expect(Array.isArray(capturedMetadata!.securityBlacklist)).toBe(true);
    });

    it('should evaluate global resolvers in array order and stop at first match', async () => {
      const callOrder: string[] = [];

      const resolver1: GlobalInterventionAuditConfig = {
        type: 'first',
        policy: 'always',
        resolver: () => {
          callOrder.push('first');
          return true; // matches
        },
      };

      const resolver2: GlobalInterventionAuditConfig = {
        type: 'second',
        policy: 'required',
        resolver: () => {
          callOrder.push('second');
          return true;
        },
      };

      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        globalInterventionAudits: [resolver1, resolver2],
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'my-tool',
        apiName: 'doSomething',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: { 'my-tool': { identifier: 'my-tool' } },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      await agent.runner(context, state);

      // Only first resolver should be called (break on first match)
      expect(callOrder).toEqual(['first']);
    });

    it('should use default security blacklist audit when globalInterventionAudits is not provided', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        // NOT providing globalInterventionAudits → should default to security blacklist
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const blacklistedTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'bash',
        apiName: 'bash',
        arguments: '{"command":"rm -rf /"}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          bash: { identifier: 'bash', humanIntervention: 'never' },
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [blacklistedTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Default global resolver (security blacklist) should catch this
      expect(result).toEqual([
        {
          type: 'request_human_approve',
          pendingToolsCalling: [blacklistedTool],
          reason: 'human_intervention_required',
        },
      ]);
    });
  });

  describe('headless mode (for async tasks)', () => {
    it('should execute all tools directly in headless mode including those requiring approval', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const toolCall: ChatToolPayload = {
        id: 'call-1',
        identifier: 'dangerous-tool',
        apiName: 'delete',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          'dangerous-tool': {
            identifier: 'dangerous-tool',
            humanIntervention: 'required', // Tool requires approval
          },
        },
        userInterventionConfig: {
          approvalMode: 'headless', // Headless mode for async tasks
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [toolCall],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute directly in headless mode
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: toolCall,
          },
        },
      ]);
    });

    it('should execute tools with "always" policy in headless mode', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const alwaysTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'agent-builder',
        apiName: 'installPlugin',
        arguments: '{"identifier":"some-plugin","source":"market"}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'agent-builder': {
            identifier: 'agent-builder',
            api: [
              {
                name: 'installPlugin',
                humanIntervention: 'always', // Always requires intervention normally
              },
            ],
          },
        },
        userInterventionConfig: {
          approvalMode: 'headless', // Headless mode bypasses even 'always'
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [alwaysTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute directly in headless mode, even for 'always' policy
      expect(result).toEqual([
        {
          type: 'call_tool',
          payload: {
            parentMessageId: 'msg-1',
            toolCalling: alwaysTool,
          },
        },
      ]);
    });

    it('should skip security blacklisted tools in headless mode', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const blacklistedTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'bash',
        apiName: 'bash',
        arguments: '{"command":"rm -rf /"}', // Matches security blacklist
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          bash: {
            identifier: 'bash',
            humanIntervention: 'never',
          },
        },
        userInterventionConfig: {
          approvalMode: 'headless',
        },
        // Using default security blacklist which blocks "rm -rf /"
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [blacklistedTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should return empty array (tool is skipped, not executed or pending)
      expect(result).toEqual([]);
    });

    it('should handle mixed tools in headless mode - execute safe ones, skip blacklisted', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const safeTool: ChatToolPayload = {
        id: 'call-1',
        identifier: 'web-search',
        apiName: 'search',
        arguments: '{"query":"hello"}',
        type: 'default',
      };

      const blacklistedTool: ChatToolPayload = {
        id: 'call-2',
        identifier: 'bash',
        apiName: 'bash',
        arguments: '{"command":"rm -rf /"}', // Matches security blacklist
        type: 'builtin',
      };

      const alwaysTool: ChatToolPayload = {
        id: 'call-3',
        identifier: 'agent-builder',
        apiName: 'installPlugin',
        arguments: '{}',
        type: 'builtin',
      };

      const state = createMockState({
        toolManifestMap: {
          'web-search': {
            identifier: 'web-search',
            humanIntervention: 'required',
          },
          'bash': {
            identifier: 'bash',
          },
          'agent-builder': {
            identifier: 'agent-builder',
            api: [
              {
                name: 'installPlugin',
                humanIntervention: 'always',
              },
            ],
          },
        },
        userInterventionConfig: {
          approvalMode: 'headless',
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [safeTool, blacklistedTool, alwaysTool],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute safeTool and alwaysTool, skip blacklistedTool
      expect(result).toEqual([
        {
          type: 'call_tools_batch',
          payload: {
            parentMessageId: 'msg-1',
            toolsCalling: [safeTool, alwaysTool],
          },
        },
      ]);
    });

    it('should execute multiple tools as batch in headless mode', async () => {
      const agent = new GeneralChatAgent({
        agentConfig: { maxSteps: 100 },
        operationId: 'test-session',
        modelRuntimeConfig: mockModelRuntimeConfig,
      });

      const tool1: ChatToolPayload = {
        id: 'call-1',
        identifier: 'search',
        apiName: 'search',
        arguments: '{}',
        type: 'default',
      };

      const tool2: ChatToolPayload = {
        id: 'call-2',
        identifier: 'crawl',
        apiName: 'crawl',
        arguments: '{}',
        type: 'default',
      };

      const state = createMockState({
        toolManifestMap: {
          search: { identifier: 'search', humanIntervention: 'required' },
          crawl: { identifier: 'crawl', humanIntervention: 'always' },
        },
        userInterventionConfig: {
          approvalMode: 'headless',
        },
      });

      const context = createMockContext('llm_result', {
        hasToolsCalling: true,
        toolsCalling: [tool1, tool2],
        parentMessageId: 'msg-1',
      });

      const result = await agent.runner(context, state);

      // Should execute both tools as batch in headless mode
      expect(result).toEqual([
        {
          type: 'call_tools_batch',
          payload: {
            parentMessageId: 'msg-1',
            toolsCalling: [tool1, tool2],
          },
        },
      ]);
    });
  });
});
