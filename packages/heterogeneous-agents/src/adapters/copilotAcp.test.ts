import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { CopilotAcpAdapter } from './copilotAcp';

const dataFor = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

describe('CopilotAcpAdapter', () => {
  it('normalizes shell tool calls with kind "execute" and no name to apiName "execute"', () => {
    const adapter = new CopilotAcpAdapter();

    const startEvents = adapter.adapt({
      kind: 'execute',
      rawInput: { command: 'pwd', description: 'Print working directory' },
      sessionUpdate: 'tool_call',
      title: 'Print working directory',
      toolCallId: 'bash-call-1',
    });

    expect(dataFor(startEvents, 'tool_start')).toEqual([
      expect.objectContaining({
        toolCallId: 'bash-call-1',
        toolCalling: expect.objectContaining({
          apiName: 'execute',
          id: 'bash-call-1',
          identifier: 'copilot',
        }),
      }),
    ]);

    const endEvents = adapter.adapt({
      content: [{ content: { text: '/repo\n', type: 'text' }, type: 'content' }],
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: 'bash-call-1',
    });

    expect(dataFor(endEvents, 'tool_end')).toEqual([
      {
        isSuccess: true,
        toolCallId: 'bash-call-1',
      },
    ]);
  });

  it('emits stream_start and step_complete with provider "copilot"', () => {
    const adapter = new CopilotAcpAdapter();

    const events = [
      ...adapter.adapt({
        model: 'claude-sonnet-4.6',
        sessionId: 'copilot-session-1',
        type: 'copilot_session',
      }),
      ...adapter.adapt({
        content: { text: 'Hello from Copilot', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
      ...adapter.adapt({
        stopReason: 'end_turn',
        type: 'copilot_prompt_completed',
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      }),
    ];

    expect(dataFor(events, 'stream_start')).toEqual([
      expect.objectContaining({
        model: 'claude-sonnet-4.6',
        provider: 'copilot',
        sessionId: 'copilot-session-1',
      }),
    ]);
    expect(dataFor(events, 'step_complete')).toEqual([
      {
        model: 'claude-sonnet-4.6',
        phase: 'turn_metadata',
        provider: 'copilot',
        usage: {
          inputCacheMissTokens: 100,
          outputTextTokens: 20,
          totalInputTokens: 100,
          totalOutputTokens: 20,
          totalTokens: 120,
        },
      },
    ]);
  });
});
