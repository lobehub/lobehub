import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claudeCode';

describe('ClaudeCodeAdapter', () => {
  describe('lifecycle', () => {
    it('emits stream_start on init system event', () => {
      const adapter = new ClaudeCodeAdapter();
      const events = adapter.adapt({
        model: 'claude-sonnet-4-6',
        session_id: 'sess_123',
        subtype: 'init',
        type: 'system',
      });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('stream_start');
      expect(events[0].data.model).toBe('claude-sonnet-4-6');
      expect(adapter.sessionId).toBe('sess_123');
    });

    it('emits stream_end + agent_runtime_end on success result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({ is_error: false, result: 'done', type: 'result' });
      expect(events.map((e) => e.type)).toEqual(['stream_end', 'agent_runtime_end']);
    });

    it('emits error on failed result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({ is_error: true, result: 'boom', type: 'result' });
      expect(events.map((e) => e.type)).toEqual(['stream_end', 'error']);
      expect(events[1].data.message).toBe('boom');
    });
  });

  describe('content mapping', () => {
    it('maps text to stream_chunk text', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'hello', type: 'text' }] },
        type: 'assistant',
      });

      const chunk = events.find((e) => e.type === 'stream_chunk' && e.data.chunkType === 'text');
      expect(chunk).toBeDefined();
      expect(chunk!.data.content).toBe('hello');
    });

    it('maps thinking to stream_chunk reasoning', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ thinking: 'considering', type: 'thinking' }] },
        type: 'assistant',
      });

      const chunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
      );
      expect(chunk).toBeDefined();
      expect(chunk!.data.reasoning).toBe('considering');
    });

    it('maps tool_use to tools_calling chunk + tool_start', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: { path: '/a' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const chunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk!.data.toolsCalling).toEqual([
        {
          apiName: 'Read',
          arguments: JSON.stringify({ path: '/a' }),
          id: 't1',
          identifier: 'claude-code',
          type: 'default',
        },
      ]);

      const toolStart = events.find((e) => e.type === 'tool_start');
      expect(toolStart).toBeDefined();
    });
  });

  describe('tool_result in user events', () => {
    it('emits tool_result event with content for user tool_result block', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [{ content: 'file contents here', tool_use_id: 't1', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result).toBeDefined();
      expect(result!.data.toolCallId).toBe('t1');
      expect(result!.data.content).toBe('file contents here');
      expect(result!.data.isError).toBe(false);

      // Should also emit tool_end
      const end = events.find((e) => e.type === 'tool_end');
      expect(end).toBeDefined();
      expect(end!.data.toolCallId).toBe('t1');
    });

    it('handles array-shaped tool_result content', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Bash', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [
                { text: 'line1', type: 'text' },
                { text: 'line2', type: 'text' },
              ],
              tool_use_id: 't1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.content).toBe('line1\nline2');
    });

    it('marks isError when tool_result is_error is true', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [{ content: 'ENOENT', is_error: true, tool_use_id: 't1', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.isError).toBe(true);
    });
  });

  describe('multi-step execution (message.id boundary)', () => {
    it('does NOT emit step boundary for the first assistant after init', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // First assistant message after init — should NOT trigger newStep
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'step 1', type: 'text' }] },
        type: 'assistant',
      });

      const types = events.map((e) => e.type);
      expect(types).not.toContain('stream_end');
      expect(types).not.toContain('stream_start');
      // Should still emit content
      const chunk = events.find((e) => e.type === 'stream_chunk');
      expect(chunk).toBeDefined();
    });

    it('emits stream_end + stream_start(newStep) when message.id changes after first', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // First assistant message (no step boundary)
      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'step 1', type: 'text' }] },
        type: 'assistant',
      });

      // Second assistant message with new id → new step
      const events = adapter.adapt({
        message: { id: 'msg_2', content: [{ text: 'step 2', type: 'text' }] },
        type: 'assistant',
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('stream_end');
      expect(types).toContain('stream_start');

      const streamStart = events.find((e) => e.type === 'stream_start');
      expect(streamStart!.data.newStep).toBe(true);
    });

    it('increments stepIndex on each new message.id (after first)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const e1 = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'a', type: 'text' }] },
        type: 'assistant',
      });
      // First assistant after init stays at step 0 (no step boundary)
      expect(e1[0].stepIndex).toBe(0);

      const e2 = adapter.adapt({
        message: { id: 'msg_2', content: [{ text: 'b', type: 'text' }] },
        type: 'assistant',
      });
      // Second message.id → stepIndex should be 1
      const newStepEvent = e2.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(newStepEvent).toBeDefined();
      expect(newStepEvent!.stepIndex).toBe(1);
    });

    it('does NOT emit new step when message.id is the same', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'a', type: 'text' }] },
        type: 'assistant',
      });

      // Same id → same step, no stream_end/stream_start
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'b', type: 'text' }] },
        type: 'assistant',
      });

      const types = events.map((e) => e.type);
      expect(types).not.toContain('stream_end');
      expect(types).not.toContain('stream_start');
    });
  });

  describe('usage and model extraction', () => {
    it('emits step_complete with turn_metadata when message has model and usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ text: 'hello', type: 'text' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        type: 'assistant',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta).toBeDefined();
      expect(meta!.data.model).toBe('claude-sonnet-4-6');
      expect(meta!.data.usage.input_tokens).toBe(100);
      expect(meta!.data.usage.output_tokens).toBe(50);
    });

    it('emits step_complete with cache token usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ text: 'hi', type: 'text' }],
          model: 'claude-sonnet-4-6',
          usage: {
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
            input_tokens: 100,
            output_tokens: 50,
          },
        },
        type: 'assistant',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta!.data.usage.cache_creation_input_tokens).toBe(200);
      expect(meta!.data.usage.cache_read_input_tokens).toBe(300);
    });
  });

  describe('flush', () => {
    it('emits tool_end for any pending tool calls', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // Start a tool call without providing result
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.flush();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_end');
      expect(events[0].data.toolCallId).toBe('t1');
    });

    it('returns empty array when no pending tools', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.flush();
      expect(events).toHaveLength(0);
    });

    it('clears pending tools after flush', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      adapter.flush();
      // Second flush should be empty
      expect(adapter.flush()).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for null/undefined/non-object input', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.adapt(null)).toEqual([]);
      expect(adapter.adapt(undefined)).toEqual([]);
      expect(adapter.adapt('string')).toEqual([]);
    });

    it('returns empty array for unknown event types (rate_limit_event)', () => {
      const adapter = new ClaudeCodeAdapter();
      const events = adapter.adapt({ type: 'rate_limit_event', data: {} });
      expect(events).toEqual([]);
    });

    it('handles assistant event without prior init (auto-starts)', () => {
      const adapter = new ClaudeCodeAdapter();
      // No system init — adapter should auto-start
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'hello', type: 'text' }] },
        type: 'assistant',
      });

      const start = events.find((e) => e.type === 'stream_start');
      expect(start).toBeDefined();

      const chunk = events.find((e) => e.type === 'stream_chunk');
      expect(chunk).toBeDefined();
      expect(chunk!.data.content).toBe('hello');
    });

    it('handles assistant event with empty content array', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [] },
        type: 'assistant',
      });
      // Should only have step_complete metadata if model/usage present, nothing else
      const chunks = events.filter((e) => e.type === 'stream_chunk');
      expect(chunks).toHaveLength(0);
    });

    it('handles multiple tool_use blocks in a single assistant event', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            { id: 't1', input: { path: '/a' }, name: 'Read', type: 'tool_use' },
            { id: 't2', input: { cmd: 'ls' }, name: 'Bash', type: 'tool_use' },
          ],
        },
        type: 'assistant',
      });

      const chunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk!.data.toolsCalling).toHaveLength(2);

      const toolStarts = events.filter((e) => e.type === 'tool_start');
      expect(toolStarts).toHaveLength(2);
    });
  });
});
