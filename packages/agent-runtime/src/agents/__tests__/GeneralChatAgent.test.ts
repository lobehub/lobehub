import { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { AgentRuntimeContext, AgentState } from '../../types';
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
        result: { success: true, taskMessageId: 'task-1', threadId: 'thread-1', result: 'Task result' },
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
          messages: state.messages,
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
          messages: state.messages,
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
});
