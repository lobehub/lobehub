/**
 * End-to-end integration test for ClaudeCodeAdapter.
 *
 * Simulates a realistic Claude Code CLI stream-json session with multiple steps:
 *   init → thinking → text → tool_use → tool_result → new step → text → result
 *
 * Verifies the complete event pipeline that the executor would consume.
 */
import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claudeCode';

/**
 * Simulate a realistic multi-step Claude Code session.
 *
 * Scenario: CC reads a file, then writes a fix in a second LLM turn.
 */
const simulatedStream = [
  // 1. System init
  {
    model: 'claude-sonnet-4-6',
    session_id: 'sess_abc123',
    subtype: 'init',
    tools: ['Read', 'Write', 'Bash'],
    type: 'system',
  },
  // 2. First assistant turn — thinking + tool_use (Read)
  {
    message: {
      content: [
        { thinking: 'Let me read the file first to understand the issue.', type: 'thinking' },
      ],
      id: 'msg_01',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      usage: { input_tokens: 500, output_tokens: 100 },
    },
    type: 'assistant',
  },
  {
    message: {
      content: [
        { id: 'toolu_read_1', input: { file_path: '/src/app.ts' }, name: 'Read', type: 'tool_use' },
      ],
      id: 'msg_01',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      usage: { input_tokens: 500, output_tokens: 150 },
    },
    type: 'assistant',
  },
  // 3. Tool result (user event)
  {
    message: {
      content: [
        {
          content: 'export function add(a: number, b: number) {\n  return a - b; // BUG\n}',
          tool_use_id: 'toolu_read_1',
          type: 'tool_result',
        },
      ],
      role: 'user',
    },
    type: 'user',
  },
  // 4. Second assistant turn — NEW message.id = new step
  {
    message: {
      content: [
        { thinking: 'Found the bug: subtract instead of add. Let me fix it.', type: 'thinking' },
      ],
      id: 'msg_02',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      usage: { input_tokens: 800, output_tokens: 80 },
    },
    type: 'assistant',
  },
  {
    message: {
      content: [
        {
          id: 'toolu_write_1',
          input: {
            content: 'export function add(a: number, b: number) {\n  return a + b;\n}',
            file_path: '/src/app.ts',
          },
          name: 'Write',
          type: 'tool_use',
        },
      ],
      id: 'msg_02',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      usage: { input_tokens: 800, output_tokens: 200 },
    },
    type: 'assistant',
  },
  // 5. Write tool result
  {
    message: {
      content: [
        {
          content: 'File written successfully.',
          tool_use_id: 'toolu_write_1',
          type: 'tool_result',
        },
      ],
      role: 'user',
    },
    type: 'user',
  },
  // 6. Third assistant turn — final text response, NEW message.id
  {
    message: {
      content: [
        {
          text: 'I fixed the bug in `/src/app.ts`. The `add` function was subtracting instead of adding.',
          type: 'text',
        },
      ],
      id: 'msg_03',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      usage: { input_tokens: 1000, output_tokens: 30 },
    },
    type: 'assistant',
  },
  // 7. Final result
  {
    is_error: false,
    result: 'I fixed the bug in `/src/app.ts`.',
    type: 'result',
  },
];

describe('ClaudeCodeAdapter E2E', () => {
  it('produces correct event sequence for a multi-step session', () => {
    const adapter = new ClaudeCodeAdapter();
    const allEvents = simulatedStream.flatMap((line) => adapter.adapt(line));

    // Extract event types for sequence verification
    const types = allEvents.map((e) => e.type);

    // 1. Should start with stream_start (from init)
    expect(types[0]).toBe('stream_start');

    // 2. Should have content chunks (thinking, tool_use, text)
    const textChunks = allEvents.filter(
      (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
    );
    expect(textChunks.length).toBeGreaterThanOrEqual(1);

    const reasoningChunks = allEvents.filter(
      (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
    );
    expect(reasoningChunks.length).toBe(2); // Two thinking blocks

    const toolChunks = allEvents.filter(
      (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
    );
    expect(toolChunks.length).toBe(2); // Read + Write

    // 3. Tool lifecycle: tool_start → tool_result → tool_end for each tool
    const toolStarts = allEvents.filter((e) => e.type === 'tool_start');
    const toolResults = allEvents.filter((e) => e.type === 'tool_result');
    const toolEnds = allEvents.filter((e) => e.type === 'tool_end');

    expect(toolStarts.length).toBe(2);
    expect(toolResults.length).toBe(2);
    expect(toolEnds.length).toBe(2);

    // Verify tool call IDs match
    expect(toolResults[0].data.toolCallId).toBe('toolu_read_1');
    expect(toolResults[1].data.toolCallId).toBe('toolu_write_1');

    // 4. Should have step boundaries (stream_end + stream_start with newStep)
    // First assistant after init does NOT trigger newStep, only subsequent message.id changes do
    const newStepStarts = allEvents.filter(
      (e) => e.type === 'stream_start' && e.data?.newStep === true,
    );
    // 2 boundaries: msg_01 → msg_02, msg_02 → msg_03
    expect(newStepStarts.length).toBe(2);

    // 5. turn_metadata is now emitted on `stream_event: message_delta`, not on
    // `assistant` events (CC echoes a stale message_start usage on every
    // content block). This simplified fixture has no stream_event records, so
    // no turn_metadata fires here — a dedicated test in claudeCode.test.ts
    // covers the message_delta flow. We still assert the result_usage summary
    // lands at session end.
    const metaEvents = allEvents.filter(
      (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
    );
    expect(metaEvents.length).toBe(0);
    const resultUsage = allEvents.filter(
      (e) => e.type === 'step_complete' && e.data?.phase === 'result_usage',
    );
    // No `result.usage` in this fixture, so none emitted either.
    expect(resultUsage.length).toBe(0);

    // 6. Should end with stream_end + agent_runtime_end (from result)
    const lastTwo = types.slice(-2);
    expect(lastTwo).toEqual(['stream_end', 'agent_runtime_end']);

    // 7. Session ID should be captured
    expect(adapter.sessionId).toBe('sess_abc123');
  });

  it('correctly extracts tool result content', () => {
    const adapter = new ClaudeCodeAdapter();
    const allEvents = simulatedStream.flatMap((line) => adapter.adapt(line));

    const toolResults = allEvents.filter((e) => e.type === 'tool_result');

    // First tool result: file content from Read
    expect(toolResults[0].data.content).toContain('return a - b');
    expect(toolResults[0].data.isError).toBe(false);

    // Second tool result: write confirmation
    expect(toolResults[1].data.content).toBe('File written successfully.');
    expect(toolResults[1].data.isError).toBe(false);
  });

  it('tracks step boundaries via stepIndex', () => {
    const adapter = new ClaudeCodeAdapter();
    const allEvents = simulatedStream.flatMap((line) => adapter.adapt(line));

    // Collect unique stepIndex values
    const stepIndices = [...new Set(allEvents.map((e) => e.stepIndex))];
    // Should have at least 3 steps (init step + msg_01 step + msg_02 step + msg_03 step)
    expect(stepIndices.length).toBeGreaterThanOrEqual(3);

    // stepIndex should be monotonically non-decreasing
    for (let i = 1; i < allEvents.length; i++) {
      expect(allEvents[i].stepIndex).toBeGreaterThanOrEqual(allEvents[i - 1].stepIndex);
    }
  });

  it('handles error result correctly in multi-step session', () => {
    const adapter = new ClaudeCodeAdapter();

    // Init + one assistant turn + error result
    adapter.adapt(simulatedStream[0]); // init
    adapter.adapt(simulatedStream[1]); // thinking

    const events = adapter.adapt({
      is_error: true,
      result: 'Permission denied: cannot write to /etc/hosts',
      type: 'result',
    });

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error!.data.message).toBe('Permission denied: cannot write to /etc/hosts');

    // Should also have stream_end before error
    expect(events[0].type).toBe('stream_end');
  });

  it('no pending tools after full session', () => {
    const adapter = new ClaudeCodeAdapter();
    simulatedStream.forEach((line) => adapter.adapt(line));

    // flush should return empty — all tools were resolved via tool_result
    const flushEvents = adapter.flush();
    expect(flushEvents).toHaveLength(0);
  });
});
