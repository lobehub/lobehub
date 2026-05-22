import { describe, expect, it } from 'vitest';

import {
  buildChatRequestAttributes,
  buildChatResponseAttributes,
  buildContextEngineeringAttributes,
  buildExecuteToolAttributes,
  buildExecuteToolResultAttributes,
  buildInvokeAgentAttributes,
  buildInvokeAgentResultAttributes,
  chatSpanName,
  CONTEXT_ENGINEERING_SPAN_NAME,
  executeToolSpanName,
  invokeAgentSpanName,
} from './attributes';

describe('agent-runtime attribute builders', () => {
  it('builds invoke_agent attributes and drops undefined fields', () => {
    const attrs = buildInvokeAgentAttributes({
      agentId: 'agent_123',
      agentName: 'researcher',
      conversationId: 'topic_abc',
      operationId: 'op_xyz',
      provider: 'openai',
      requestModel: 'gpt-5',
      stepIndex: 0,
    });

    expect(attrs).toEqual({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.id': 'agent_123',
      'gen_ai.agent.name': 'researcher',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-5',
      'gen_ai.conversation.id': 'topic_abc',
      'lobehub.agent.operation.id': 'op_xyz',
      'lobehub.agent.step.index': 0,
    });
    expect(attrs).not.toHaveProperty('gen_ai.agent.description');
  });

  it('builds invoke_agent result attributes with completion reason', () => {
    const attrs = buildInvokeAgentResultAttributes({
      completionReason: 'done',
      inputTokens: 1000,
      outputTokens: 200,
      stepCount: 5,
    });

    expect(attrs).toEqual({
      'gen_ai.usage.input_tokens': 1000,
      'gen_ai.usage.output_tokens': 200,
      'lobehub.agent.step.count': 5,
      'lobehub.agent.completion_reason': 'done',
    });
  });

  it('builds chat request attributes including stream flag', () => {
    const attrs = buildChatRequestAttributes({
      operationId: 'op_xyz',
      provider: 'openai',
      requestModel: 'gpt-5',
      stepIndex: 2,
      stream: true,
      temperature: 0.7,
    });

    expect(attrs['gen_ai.operation.name']).toBe('chat');
    expect(attrs['gen_ai.provider.name']).toBe('openai');
    expect(attrs['gen_ai.request.stream']).toBe(true);
    expect(attrs['gen_ai.request.temperature']).toBe(0.7);
    expect(attrs).not.toHaveProperty('gen_ai.request.max_tokens');
  });

  it('builds chat response attributes including TTFT seconds and cache tokens', () => {
    const attrs = buildChatResponseAttributes({
      cacheReadInputTokens: 30,
      finishReasons: ['stop'],
      inputTokens: 120,
      outputTokens: 80,
      reasoningOutputTokens: 50,
      responseId: 'chatcmpl-123',
      responseModel: 'gpt-5-2026-01-01',
      timeToFirstChunkMs: 480,
    });

    expect(attrs).toEqual({
      'gen_ai.response.id': 'chatcmpl-123',
      'gen_ai.response.model': 'gpt-5-2026-01-01',
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.response.time_to_first_chunk': 0.48,
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 80,
      'gen_ai.usage.cache_read.input_tokens': 30,
      'gen_ai.usage.reasoning.output_tokens': 50,
    });
  });

  it('builds execute_tool attributes including tool type and call id', () => {
    const attrs = buildExecuteToolAttributes({
      operationId: 'op_xyz',
      stepIndex: 1,
      toolCallId: 'call_42',
      toolName: 'web_search',
      toolSource: 'builtin',
      toolType: 'function',
    });

    expect(attrs).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': 'web_search',
      'gen_ai.tool.type': 'function',
      'gen_ai.tool.call.id': 'call_42',
      'lobehub.tool.source': 'builtin',
      'lobehub.agent.operation.id': 'op_xyz',
      'lobehub.agent.step.index': 1,
    });
  });

  it('builds execute_tool result attributes', () => {
    const attrs = buildExecuteToolResultAttributes({
      attempts: 2,
      success: false,
    });

    expect(attrs).toEqual({
      'lobehub.tool.success': false,
      'lobehub.tool.attempts': 2,
    });
  });

  it('builds context_engineering attributes for snapshot-level metadata', () => {
    const attrs = buildContextEngineeringAttributes({
      hasImages: true,
      historyCompressed: false,
      knowledgeCount: 3,
      knowledgeInjected: true,
      memoryInjected: true,
      messageCount: 12,
      operationId: 'op_xyz',
      stepIndex: 0,
      systemRoleLength: 1024,
      toolCount: 7,
    });

    expect(attrs).toMatchObject({
      'lobehub.context.message_count': 12,
      'lobehub.context.knowledge_injected': true,
      'lobehub.context.knowledge_count': 3,
      'lobehub.context.history_compressed': false,
      'lobehub.context.memory_injected': true,
      'lobehub.context.system_role_length': 1024,
      'lobehub.context.tool_count': 7,
      'lobehub.context.has_images': true,
      'lobehub.agent.operation.id': 'op_xyz',
      'lobehub.agent.step.index': 0,
    });
    expect(attrs).not.toHaveProperty('lobehub.context.token_usage');
    expect(attrs).not.toHaveProperty('lobehub.context.window_ratio');
  });

  it('formats span names per gen_ai convention', () => {
    expect(invokeAgentSpanName('researcher')).toBe('invoke_agent researcher');
    expect(invokeAgentSpanName()).toBe('invoke_agent');
    expect(chatSpanName('gpt-5')).toBe('chat gpt-5');
    expect(executeToolSpanName('web_search')).toBe('execute_tool web_search');
    expect(CONTEXT_ENGINEERING_SPAN_NAME).toBe('context_engineering');
  });
});
