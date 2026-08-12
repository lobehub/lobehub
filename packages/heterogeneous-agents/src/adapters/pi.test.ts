import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { PiAdapter } from './pi';

const dataFor = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

describe('PiAdapter', () => {
  it('captures the native session and maps streamed text, usage, and settlement', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ cwd: '/repo', id: 'pi-session-1', type: 'session', version: 3 }),
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { delta: 'Hello', type: 'text_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'Hello', type: 'text' }],
          model: 'claude-sonnet-4-5',
          provider: 'anthropic',
          responseModel: 'claude-sonnet-4-5-20250929',
          role: 'assistant',
          stopReason: 'stop',
          usage: {
            cacheRead: 3,
            cacheWrite: 2,
            cost: { total: 0.01 },
            input: 10,
            output: 5,
            reasoning: 2,
            totalTokens: 20,
          },
        },
        type: 'message_end',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(adapter.sessionId).toBe('pi-session-1');
    expect(dataFor(events, 'stream_start')).toEqual([
      { provider: 'pi', sessionId: 'pi-session-1' },
    ]);
    expect(dataFor(events, 'stream_chunk')).toEqual([{ chunkType: 'text', content: 'Hello' }]);
    expect(dataFor(events, 'step_complete')).toEqual([
      {
        costUsd: 0.01,
        model: 'claude-sonnet-4-5-20250929',
        phase: 'turn_metadata',
        provider: 'pi',
        usage: {
          inputCachedTokens: 3,
          inputCacheMissTokens: 10,
          inputWriteCacheTokens: 2,
          outputReasoningTokens: 2,
          outputTextTokens: 3,
          totalInputTokens: 15,
          totalOutputTokens: 5,
          totalTokens: 20,
        },
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'stream_start',
      'stream_chunk',
      'step_complete',
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
    expect(adapter.flush()).toEqual([]);
  });

  it('emits only unstreamed suffixes from final assistant snapshots', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { contentIndex: 0, delta: 'Hel', type: 'text_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        assistantMessageEvent: { contentIndex: 1, delta: 'Plan', type: 'thinking_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        message: {
          content: [
            { text: 'Hello', type: 'text' },
            { thinking: 'Planning', type: 'thinking' },
          ],
          role: 'assistant',
          stopReason: 'stop',
        },
        type: 'message_end',
      }),
    ];

    expect(dataFor(events, 'stream_chunk')).toEqual([
      { chunkType: 'text', content: 'Hel' },
      { chunkType: 'reasoning', reasoning: 'Plan' },
      { chunkType: 'text', content: 'lo' },
      { chunkType: 'reasoning', reasoning: 'ning' },
    ]);
  });

  it('streams thinking and emits each tool call and result once', () => {
    const adapter = new PiAdapter();
    const toolCall = {
      arguments: { path: '/repo/a.ts' },
      id: 'tool-1',
      name: 'read',
      type: 'toolCall',
    };
    const events = [
      ...adapter.adapt({ id: 'pi-session-tools', type: 'session' }),
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { delta: 'Inspecting', type: 'thinking_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        assistantMessageEvent: { toolCall, type: 'toolcall_end' },
        type: 'message_update',
      }),
      // Pi also emits a tool_execution_start event for the same native call.
      ...adapter.adapt({
        args: toolCall.arguments,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        type: 'tool_execution_start',
      }),
      ...adapter.adapt({
        isError: false,
        result: { content: [{ text: 'file text', type: 'text' }] },
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        type: 'tool_execution_end',
      }),
      ...adapter.adapt({
        message: {
          content: [
            { text: 'file text', type: 'text' },
            { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' },
          ],
          isError: false,
          role: 'toolResult',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
        type: 'message_end',
      }),
      // A duplicate final artifact must not replay the tool result.
      ...adapter.adapt({
        message: {
          content: [{ text: 'file text', type: 'text' }],
          isError: false,
          role: 'toolResult',
          toolCallId: toolCall.id,
        },
        type: 'message_end',
      }),
    ];

    expect(dataFor(events, 'stream_chunk')).toEqual([
      { chunkType: 'reasoning', reasoning: 'Inspecting' },
      {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'read',
            arguments: '{"path":"/repo/a.ts"}',
            id: 'tool-1',
            identifier: 'pi',
            type: 'default',
          },
        ],
      },
    ]);
    expect(dataFor(events, 'tool_start')).toHaveLength(1);
    expect(dataFor(events, 'tool_result')).toEqual([
      {
        content: 'file text\n[Image: image/png]',
        isError: false,
        pluginState: { images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }] },
        toolCallId: 'tool-1',
      },
    ]);
    expect(dataFor(events, 'tool_end')).toHaveLength(1);
  });

  it('maps provider auth failures only after the whole Pi run settles', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: {
          error: {
            errorMessage: 'No API key found for provider anthropic',
            model: 'claude-sonnet-4-5',
            provider: 'anthropic',
            stopReason: 'error',
          },
          type: 'error',
        },
        type: 'message_update',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
    ];
    const agentEndEvents = adapter.adapt({ type: 'agent_end', willRetry: false });

    expect(agentEndEvents).toEqual([]);
    events.push(...agentEndEvents, ...adapter.adapt({ type: 'agent_settled' }));

    expect(dataFor(events, 'error')).toEqual([
      expect.objectContaining({
        agentType: 'pi',
        clearEchoedContent: true,
        code: 'auth_required',
        message: 'Pi could not authenticate. Run `pi`, enter `/login`, then retry.',
      }),
    ]);
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      'stream_end',
      'visible_output_end',
      'error',
    ]);
    expect(adapter.adapt({ type: 'agent_settled' })).toEqual([]);
    expect(adapter.flush()).toEqual([]);
  });

  it('surfaces an overflow when Pi settles without compacting', () => {
    const adapter = new PiAdapter();
    const overflowError = {
      errorMessage: 'Your input exceeds the context window of this model.',
      model: 'gpt-5.6-luna',
      provider: 'openai-codex',
      stopReason: 'error',
    };
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({ message: { ...overflowError, role: 'assistant' }, type: 'message_end' }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(dataFor(events, 'agent_runtime_end')).toEqual([]);
    expect(dataFor(events, 'error')).toEqual([
      expect.objectContaining({
        message: 'Your input exceeds the context window of this model.',
      }),
    ]);
  });

  it('does not emit a terminal error when Pi retries and later succeeds', () => {
    const adapter = new PiAdapter();
    const retryError = {
      errorMessage: 'Provider overloaded',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      stopReason: 'error',
    };
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { error: retryError, reason: 'error', type: 'error' },
        type: 'message_update',
      }),
      ...adapter.adapt({ message: { ...retryError, role: 'assistant' }, type: 'message_end' }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: true }),
      ...adapter.adapt({
        attempt: 1,
        delayMs: 1000,
        errorMessage: 'Provider overloaded',
        maxAttempts: 3,
        type: 'auto_retry_start',
      }),
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { delta: 'Recovered', type: 'text_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'Recovered', type: 'text' }],
          model: 'claude-sonnet-4-5',
          role: 'assistant',
          stopReason: 'stop',
          usage: { cacheRead: 0, cacheWrite: 0, input: 5, output: 1, totalTokens: 6 },
        },
        type: 'message_end',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(dataFor(events, 'error')).toEqual([]);
    expect(dataFor(events, 'stream_retry')).toHaveLength(1);
    expect(dataFor(events, 'stream_start')).toHaveLength(2);
    expect(dataFor(events, 'stream_chunk')).toContainEqual({
      chunkType: 'text',
      content: 'Recovered',
    });
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{}]);
  });

  it('waits through overflow compaction and ends successfully after Pi recovers', () => {
    const adapter = new PiAdapter();
    const overflowError = {
      errorMessage: 'Your input exceeds the context window of this model.',
      model: 'gpt-5.6-luna',
      provider: 'openai-codex',
      stopReason: 'error',
    };
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({ message: { ...overflowError, role: 'assistant' }, type: 'message_end' }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ reason: 'overflow', type: 'compaction_start' }),
      ...adapter.adapt({
        aborted: false,
        reason: 'overflow',
        result: { estimatedTokensAfter: 1856, tokensBefore: 371_835 },
        type: 'compaction_end',
        willRetry: true,
      }),
      ...adapter.adapt({ type: 'agent_start' }),
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: { delta: 'Recovered after compaction', type: 'text_delta' },
        type: 'message_update',
      }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'Recovered after compaction', type: 'text' }],
          model: 'gpt-5.6-luna',
          provider: 'openai-codex',
          role: 'assistant',
          stopReason: 'stop',
          usage: { cacheRead: 0, cacheWrite: 0, input: 10, output: 2, totalTokens: 12 },
        },
        type: 'message_end',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(dataFor(events, 'error')).toEqual([]);
    expect(
      events.filter((event) => event.type === 'stream_start').map((event) => event.stepIndex),
    ).toEqual([0, 1]);
    expect(dataFor(events, 'stream_chunk')).toContainEqual({
      chunkType: 'text',
      content: 'Recovered after compaction',
    });
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{}]);
  });

  it('surfaces a failed overflow compaction when Pi settles', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        message: {
          errorMessage: 'Your input exceeds the context window of this model.',
          model: 'gpt-5.6-luna',
          provider: 'openai-codex',
          role: 'assistant',
          stopReason: 'error',
        },
        type: 'message_end',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ reason: 'overflow', type: 'compaction_start' }),
      ...adapter.adapt({
        aborted: false,
        errorMessage: 'Context overflow recovery failed: summary request failed',
        reason: 'overflow',
        type: 'compaction_end',
        willRetry: false,
      }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(dataFor(events, 'agent_runtime_end')).toEqual([]);
    expect(dataFor(events, 'error')).toEqual([
      expect.objectContaining({
        details: {
          model: 'gpt-5.6-luna',
          modelProvider: 'openai-codex',
          stopReason: 'error',
        },
        message: 'Context overflow recovery failed: summary request failed',
      }),
    ]);
  });

  it('keeps a successful answer successful when threshold compaction fails', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        message: {
          content: [{ text: 'The answer completed before compaction.', type: 'text' }],
          model: 'gpt-5.6-luna',
          provider: 'openai-codex',
          role: 'assistant',
          stopReason: 'stop',
        },
        type: 'message_end',
      }),
      ...adapter.adapt({ type: 'turn_end' }),
      ...adapter.adapt({ type: 'agent_end', willRetry: false }),
      ...adapter.adapt({ reason: 'threshold', type: 'compaction_start' }),
      ...adapter.adapt({
        aborted: false,
        errorMessage: 'Auto-compaction failed: summary request failed',
        reason: 'threshold',
        type: 'compaction_end',
        willRetry: false,
      }),
      ...adapter.adapt({ type: 'agent_settled' }),
    ];

    expect(dataFor(events, 'error')).toEqual([]);
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{}]);
  });

  it('flushes the pending failure if Pi exits during a retry before settling', () => {
    const adapter = new PiAdapter();
    const retryError = {
      errorMessage: 'Provider overloaded',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      stopReason: 'error',
    };

    adapter.adapt({ type: 'turn_start' });
    adapter.adapt({ message: { ...retryError, role: 'assistant' }, type: 'message_end' });
    adapter.adapt({ type: 'turn_end' });
    adapter.adapt({ type: 'agent_end', willRetry: true });
    adapter.adapt({
      attempt: 1,
      delayMs: 1000,
      errorMessage: retryError.errorMessage,
      maxAttempts: 3,
      type: 'auto_retry_start',
    });

    const events = adapter.flush();

    expect(dataFor(events, 'agent_runtime_end')).toEqual([]);
    expect(dataFor(events, 'error')).toEqual([
      expect.objectContaining({ message: 'Provider overloaded' }),
    ]);
  });

  it('treats an aborted Pi response as an interrupted outcome, not an error', () => {
    const adapter = new PiAdapter();
    const events = [
      ...adapter.adapt({ type: 'turn_start' }),
      ...adapter.adapt({
        assistantMessageEvent: {
          error: { errorMessage: 'Request aborted', stopReason: 'aborted' },
          reason: 'aborted',
          type: 'error',
        },
        type: 'message_update',
      }),
    ];

    expect(dataFor(events, 'error')).toEqual([]);
    expect(dataFor(events, 'agent_runtime_end')).toEqual([
      { kind: 'aborted', reason: 'interrupted' },
    ]);
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
    expect(adapter.adapt({ type: 'agent_settled' })).toEqual([]);
  });

  it('flushes completed and incomplete tools before the runtime fallback end', () => {
    const adapter = new PiAdapter();
    adapter.adapt({ type: 'turn_start' });
    adapter.adapt({ args: {}, toolCallId: 'done', toolName: 'read', type: 'tool_execution_start' });
    adapter.adapt({
      isError: false,
      result: { content: [{ text: 'ok', type: 'text' }] },
      toolCallId: 'done',
      type: 'tool_execution_end',
    });
    adapter.adapt({
      args: {},
      toolCallId: 'incomplete',
      toolName: 'bash',
      type: 'tool_execution_start',
    });

    const events = adapter.flush();
    expect(dataFor(events, 'tool_result')).toEqual([
      { content: 'ok', isError: false, toolCallId: 'done' },
    ]);
    expect(dataFor(events, 'tool_end')).toEqual([
      expect.objectContaining({ isSuccess: true, toolCallId: 'done' }),
      { isSuccess: false, toolCallId: 'incomplete' },
    ]);
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      'stream_end',
      'visible_output_end',
      'agent_runtime_end',
    ]);
  });
});
