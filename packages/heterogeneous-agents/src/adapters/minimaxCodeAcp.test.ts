import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { MinimaxCodeAcpAdapter } from './minimaxCodeAcp';

const dataFor = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

describe('MinimaxCodeAcpAdapter', () => {
  it('maps ACP text, reasoning, tool snapshots, and completion without inventing usage', () => {
    const adapter = new MinimaxCodeAcpAdapter();
    const events = [
      ...adapter.adapt({ sessionId: 'mcode-session-1', type: 'minimax_code_session' }),
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
      ...adapter.adapt({
        rawOutput: 'done',
        sessionUpdate: 'tool_call_update',
        status: 'completed',
        toolCallId: 'tool-1',
      }),
      ...adapter.adapt({ stopReason: 'end_turn', type: 'minimax_code_prompt_completed' }),
    ];

    expect(adapter.sessionId).toBe('mcode-session-1');
    expect(dataFor(events, 'stream_start')).toEqual([
      { provider: 'minimax-code', sessionId: 'mcode-session-1' },
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
            identifier: 'minimax-code',
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
    expect(dataFor(events, 'agent_runtime_end')).toEqual([{ stopReason: 'end_turn' }]);
  });

  it('maps a cancelled prompt to an interrupted runtime end', () => {
    const adapter = new MinimaxCodeAcpAdapter();
    const events = adapter.adapt({
      stopReason: 'cancelled',
      type: 'minimax_code_prompt_completed',
    });

    expect(dataFor(events, 'agent_runtime_end')).toEqual([
      { reason: 'interrupted', stopReason: 'cancelled' },
    ]);
  });
});
