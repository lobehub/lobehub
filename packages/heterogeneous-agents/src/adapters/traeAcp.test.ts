import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { TraeAcpAdapter } from './traeAcp';

const dataFor = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

describe('TraeAcpAdapter', () => {
  it('maps ACP text, reasoning, tool snapshots, and completion without inventing usage', () => {
    const adapter = new TraeAcpAdapter();
    const events = [
      ...adapter.adapt({ model: 'doubao-seed-code', type: 'session_configured' }),
      ...adapter.adapt({ sessionId: 'trae-session-1', type: 'trae_session' }),
      ...adapter.adapt({
        content: { text: 'Hello', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
      ...adapter.adapt({
        content: { text: 'Thinking', type: 'text' },
        sessionUpdate: 'agent_thought_chunk',
      }),
      ...adapter.adapt({
        kind: 'execute',
        parameters: { command: 'pwd' },
        sessionUpdate: 'tool_call',
        title: 'Run command',
        toolCallId: 'tool-1',
      }),
      ...adapter.adapt({
        content: [{ content: { text: '/work', type: 'text' }, type: 'content' }],
        sessionUpdate: 'tool_call_update',
        status: 'in_progress',
        toolCallId: 'tool-1',
      }),
      ...adapter.adapt({
        output: 'done',
        sessionUpdate: 'tool_call_update',
        status: 'completed',
        toolCallId: 'tool-1',
      }),
      // TRAE may repeat the terminal tool snapshot; it must not duplicate the result.
      ...adapter.adapt({
        rawOutput: 'done',
        sessionUpdate: 'tool_call_update',
        status: 'completed',
        toolCallId: 'tool-1',
      }),
      ...adapter.adapt({ stopReason: 'end_turn', type: 'trae_prompt_completed' }),
    ];

    expect(adapter.sessionId).toBe('trae-session-1');
    expect(dataFor(events, 'stream_start')).toEqual([
      { model: 'doubao-seed-code', provider: 'trae', sessionId: 'trae-session-1' },
    ]);
    expect(dataFor(events, 'stream_chunk')).toEqual([
      { chunkType: 'text', content: 'Hello' },
      { chunkType: 'reasoning', reasoning: 'Thinking' },
      {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'Run command',
            arguments: '{"command":"pwd"}',
            id: 'tool-1',
            identifier: 'trae',
            type: 'default',
          },
        ],
      },
      expect.objectContaining({
        chunkType: 'tool_state',
        snapshotMode: 'replace',
        snapshotSeq: 1,
        toolCallId: 'tool-1',
      }),
    ]);
    expect(dataFor(events, 'tool_start')).toHaveLength(1);
    expect(dataFor(events, 'tool_result')).toEqual([
      {
        content: 'done',
        isError: false,
        toolCallId: 'tool-1',
      },
    ]);
    expect(dataFor(events, 'tool_end')).toEqual([{ isSuccess: true, toolCallId: 'tool-1' }]);
    expect(dataFor(events, 'stream_end')).toEqual([{ stopReason: 'end_turn' }]);
    expect(dataFor(events, 'step_complete')).toEqual([]);
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{ stopReason: 'end_turn' }]);
    expect(adapter.flush()).toEqual([]);
  });

  it('starts and fails a tool from a terminal update when no start update was observed', () => {
    const adapter = new TraeAcpAdapter();
    adapter.adapt({ sessionId: 'trae-session-2', type: 'trae_session' });

    const events = adapter.adapt({
      rawInput: { path: 'missing.ts' },
      rawOutput: { message: 'not found' },
      sessionUpdate: 'tool_call_update',
      status: 'failed',
      title: 'Read file',
      toolCallId: 'tool-2',
    });

    expect(dataFor(events, 'tool_start')).toHaveLength(1);
    expect(dataFor(events, 'tool_result')).toEqual([
      {
        content: '{"message":"not found"}',
        isError: true,
        toolCallId: 'tool-2',
      },
    ]);
    expect(dataFor(events, 'tool_end')).toEqual([{ isSuccess: false, toolCallId: 'tool-2' }]);
  });

  it('preserves tool content from a running update when the terminal update only has status', () => {
    const adapter = new TraeAcpAdapter();

    adapter.adapt({
      sessionUpdate: 'tool_call',
      title: 'Read file',
      toolCallId: 'tool-content',
    });
    adapter.adapt({
      content: [{ content: { text: 'file contents', type: 'text' }, type: 'content' }],
      sessionUpdate: 'tool_call_update',
      status: 'in_progress',
      toolCallId: 'tool-content',
    });
    const events = adapter.adapt({
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'tool-content',
    });

    expect(dataFor(events, 'tool_result')).toEqual([
      { content: 'file contents', isError: false, toolCallId: 'tool-content' },
    ]);
  });

  it('opens a new step after every parallel tool in the previous round completes', () => {
    const adapter = new TraeAcpAdapter();
    adapter.adapt({ sessionId: 'trae-session-steps', type: 'trae_session' });
    adapter.adapt({
      sessionUpdate: 'tool_call',
      title: 'First tool',
      toolCallId: 'tool-a',
    });
    adapter.adapt({
      sessionUpdate: 'tool_call',
      title: 'Second tool',
      toolCallId: 'tool-b',
    });

    const firstResult = adapter.adapt({
      output: 'A',
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'tool-a',
    });
    const secondResult = adapter.adapt({
      output: 'B',
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'tool-b',
    });
    const finalText = adapter.adapt({
      content: { text: 'Final answer', type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    });

    expect(firstResult.some((event) => event.data?.newStep)).toBe(false);
    expect(secondResult.some((event) => event.data?.newStep)).toBe(false);
    expect(firstResult.every((event) => event.stepIndex === 0)).toBe(true);
    expect(secondResult.every((event) => event.stepIndex === 0)).toBe(true);
    expect(finalText).toEqual([
      expect.objectContaining({ data: {}, stepIndex: 0, type: 'stream_end' }),
      expect.objectContaining({
        data: { newStep: true, provider: 'trae', sessionId: 'trae-session-steps' },
        stepIndex: 1,
        type: 'stream_start',
      }),
      expect.objectContaining({
        data: { chunkType: 'text', content: 'Final answer' },
        stepIndex: 1,
        type: 'stream_chunk',
      }),
    ]);
  });

  it('ignores malformed and unknown updates and closes pending tools during flush', () => {
    const adapter = new TraeAcpAdapter();

    expect(adapter.adapt(null)).toEqual([]);
    expect(adapter.adapt({ sessionUpdate: 'unknown' })).toEqual([]);
    expect(adapter.adapt({ sessionUpdate: 'tool_call' })).toEqual([]);

    adapter.adapt({
      sessionUpdate: 'tool_call',
      title: 'Pending tool',
      toolCallId: 'tool-pending',
    });
    const events = adapter.flush();

    expect(dataFor(events, 'tool_end')).toEqual([{ isSuccess: false, toolCallId: 'tool-pending' }]);
    expect(dataFor(events, 'stream_end')).toEqual([{ stopReason: 'end_turn' }]);
    expect(adapter.flush()).toEqual([]);
  });

  it('maps a terminal ACP failure once', () => {
    const adapter = new TraeAcpAdapter();
    adapter.adapt({
      content: { text: 'Partial', type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    });

    const events = adapter.adapt({ message: 'permission denied', type: 'trae_error' });

    expect(dataFor(events, 'error')).toEqual([
      {
        agentType: 'trae',
        error: 'permission denied',
        message: 'permission denied',
      },
    ]);
    expect(adapter.adapt({ message: 'duplicate', type: 'trae_error' })).toEqual([]);
    expect(adapter.flush()).toEqual([]);
  });

  it('maps a cancelled ACP prompt to an interrupted runtime', () => {
    const adapter = new TraeAcpAdapter();

    const events = adapter.adapt({ stopReason: 'cancelled', type: 'trae_prompt_completed' });

    expect(dataFor(events, 'agent_runtime_end')).toEqual([
      { reason: 'interrupted', stopReason: 'cancelled' },
    ]);
  });

  it('parameterizes provider, event prefix, and per-payload identifier for other ACP agents', () => {
    const adapter = new TraeAcpAdapter({ eventPrefix: 'cursor', provider: 'cursor' });
    adapter.adapt({ sessionId: 'cursor-session-1', type: 'cursor_session' });

    const events = [
      ...adapter.adapt({
        identifier: 'claude-code',
        rawInput: { questions: [] },
        sessionUpdate: 'tool_call',
        title: 'askUserQuestion',
        toolCallId: 'ask-1',
      }),
      ...adapter.adapt({ stopReason: 'end_turn', type: 'cursor_prompt_completed' }),
    ];

    expect(adapter.sessionId).toBe('cursor-session-1');
    expect(dataFor(events, 'stream_start')).toEqual([
      { provider: 'cursor', sessionId: 'cursor-session-1' },
    ]);
    expect(dataFor(events, 'tool_start')[0]).toMatchObject({
      toolCalling: { apiName: 'askUserQuestion', id: 'ask-1', identifier: 'claude-code' },
    });
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{ stopReason: 'end_turn' }]);
  });
});
