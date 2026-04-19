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

  describe('TodoWrite pluginState synthesis', () => {
    const driveTodoWrite = (adapter: ClaudeCodeAdapter, input: unknown, toolId = 't1') => {
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: toolId, input, name: 'TodoWrite', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [
            {
              content: 'Todos have been modified successfully',
              tool_use_id: toolId,
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });
      const result = events.find((e) => e.type === 'tool_result');
      return result!.data.pluginState as
        | { todos: { items: Array<{ status: string; text: string }>; updatedAt: string } }
        | undefined;
    };

    it('maps pending/in_progress/completed to todo/processing/completed', () => {
      const adapter = new ClaudeCodeAdapter();
      const pluginState = driveTodoWrite(adapter, {
        todos: [
          { activeForm: 'Doing A', content: 'Do A', status: 'in_progress' },
          { activeForm: 'Doing B', content: 'Do B', status: 'pending' },
          { activeForm: 'Doing C', content: 'Do C', status: 'completed' },
        ],
      });

      expect(pluginState).toBeDefined();
      expect(pluginState!.todos.items).toEqual([
        { status: 'processing', text: 'Doing A' },
        { status: 'todo', text: 'Do B' },
        { status: 'completed', text: 'Do C' },
      ]);
      expect(new Date(pluginState!.todos.updatedAt).toISOString()).toBe(
        pluginState!.todos.updatedAt,
      );
    });

    it('falls back to content when activeForm is missing on in_progress item', () => {
      const adapter = new ClaudeCodeAdapter();
      const pluginState = driveTodoWrite(adapter, {
        todos: [{ activeForm: '', content: 'Do the thing', status: 'in_progress' }],
      });
      expect(pluginState!.todos.items[0]).toEqual({
        status: 'processing',
        text: 'Do the thing',
      });
    });

    it('does not set pluginState for non-TodoWrite tools', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: { path: '/a' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 't1', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });
      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.pluginState).toBeUndefined();
    });

    it('does NOT synthesize pluginState when tool_result is marked is_error', () => {
      // Guard: a failed TodoWrite was never applied on CC's side; persisting
      // a derived snapshot would let `selectTodosFromMessages` overwrite the
      // live todo UI with changes that never actually happened.
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            {
              id: 't1',
              input: { todos: [{ activeForm: 'A', content: 'a', status: 'pending' }] },
              name: 'TodoWrite',
              type: 'tool_use',
            },
          ],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [
            {
              content: 'Invalid todos payload',
              is_error: true,
              tool_use_id: 't1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });
      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.isError).toBe(true);
      expect(result!.data.pluginState).toBeUndefined();

      // Cache must still be drained — a later TodoWrite on a new id should
      // synthesize only from its own args, not inherit the failed one.
      adapter.adapt({
        message: {
          id: 'msg_2',
          content: [
            {
              id: 't2',
              input: { todos: [{ activeForm: 'B', content: 'b', status: 'completed' }] },
              name: 'TodoWrite',
              type: 'tool_use',
            },
          ],
        },
        type: 'assistant',
      });
      const next = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 't2', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });
      const nextState = next.find((e) => e.type === 'tool_result')!.data.pluginState;
      expect(nextState.todos.items).toEqual([{ status: 'completed', text: 'b' }]);
    });

    it('drains the cached input so a repeat tool_use id gets a fresh synthesis', () => {
      const adapter = new ClaudeCodeAdapter();
      const first = driveTodoWrite(adapter, {
        todos: [{ activeForm: 'A', content: 'a', status: 'pending' }],
      });
      expect(first!.todos.items).toHaveLength(1);

      // Second TodoWrite on a new tool_use id — should resynthesize from its
      // own args, not leak from the prior cache.
      adapter.adapt({
        message: {
          id: 'msg_2',
          content: [
            {
              id: 't2',
              input: { todos: [{ activeForm: 'B', content: 'b', status: 'completed' }] },
              name: 'TodoWrite',
              type: 'tool_use',
            },
          ],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 't2', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });
      const second = events.find((e) => e.type === 'tool_result')!.data.pluginState;
      expect(second.todos.items).toEqual([{ status: 'completed', text: 'b' }]);
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
    // Under `--include-partial-messages` (our preset default), CC emits a
    // stale `message_start.usage` snapshot (e.g. `output_tokens: 8`) that it
    // echoes verbatim on every content-block `assistant` event. The
    // authoritative per-turn total only arrives later as `message_delta`.
    // So turn_metadata emission is wired to `message_delta`, not `assistant`.
    it('does NOT emit turn_metadata on assistant events (usage there is stale)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ text: 'hello', type: 'text' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 1 }, // stale placeholder
        },
        type: 'assistant',
      });

      expect(
        events.find((e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata'),
      ).toBeUndefined();
    });

    it('emits turn_metadata on message_delta with authoritative usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // stream_event:message_start primes the current message id + model
      adapter.adapt({
        event: {
          message: { id: 'msg_1', model: 'claude-sonnet-4-6' },
          type: 'message_start',
        },
        type: 'stream_event',
      });

      // message_delta carries the final per-turn usage
      const events = adapter.adapt({
        event: {
          type: 'message_delta',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        type: 'stream_event',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta).toBeDefined();
      expect(meta!.data.model).toBe('claude-sonnet-4-6');
      expect(meta!.data.provider).toBe('claude-code');
      expect(meta!.data.usage).toEqual({
        inputCacheMissTokens: 100,
        inputCachedTokens: undefined,
        inputWriteCacheTokens: undefined,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      });
    });

    it('normalizes cache creation and cache read from message_delta usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        event: {
          message: { id: 'msg_1', model: 'claude-sonnet-4-6' },
          type: 'message_start',
        },
        type: 'stream_event',
      });

      const events = adapter.adapt({
        event: {
          type: 'message_delta',
          usage: {
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
            input_tokens: 100,
            output_tokens: 50,
          },
        },
        type: 'stream_event',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta!.data.usage).toEqual({
        inputCacheMissTokens: 100,
        inputCachedTokens: 300,
        inputWriteCacheTokens: 200,
        totalInputTokens: 600,
        totalOutputTokens: 50,
        totalTokens: 650,
      });
    });

    it('uses model from the latest assistant event when message_start lacks one', () => {
      // Non-partial edge case: no message_start carries model, but assistant
      // events always do. The adapter should still attach the right model.
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        event: { message: { id: 'msg_1' }, type: 'message_start' },
        type: 'stream_event',
      });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ text: 'hi', type: 'text' }],
          model: 'claude-opus-4-7',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        event: {
          type: 'message_delta',
          usage: { input_tokens: 10, output_tokens: 100 },
        },
        type: 'stream_event',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta!.data.model).toBe('claude-opus-4-7');
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

  // ──────────────────────────────────────────────────────────────
  // Cumulative tools_calling (orphan tool regression)
  //
  // CC streams each tool_use content block in its OWN assistant event, even
  // when multiple tools belong to the same LLM turn (same message.id). The
  // in-memory handler dispatch updates assistant.tools via a REPLACING array
  // merge — so if the adapter emitted only the newest tool on each chunk,
  // earlier tools would vanish from the in-memory assistant.tools[] between
  // tool_result refreshes and render as orphans. Adapter must emit the full
  // cumulative list per message.id so the replacing merge preserves history.
  // ──────────────────────────────────────────────────────────────

  describe('cumulative tools_calling per message.id', () => {
    it('includes prior tools in tools_calling when a new tool_use arrives on same message.id', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // First tool_use block of msg_1
      const e1 = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: { path: '/a' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const chunk1 = e1.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk1!.data.toolsCalling.map((t: any) => t.id)).toEqual(['t1']);

      // Second tool_use block on the SAME message.id — must carry both t1 + t2
      const e2 = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't2', input: { cmd: 'ls' }, name: 'Bash', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const chunk2 = e2.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk2!.data.toolsCalling.map((t: any) => t.id)).toEqual(['t1', 't2']);
    });

    it('emits tool_start only for newly-seen tools, not for the cumulative prior ones', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const e2 = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't2', input: {}, name: 'Bash', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const starts = e2.filter((e) => e.type === 'tool_start');
      expect(starts).toHaveLength(1);
      expect(starts[0].data.toolCalling.id).toBe('t2');
    });

    it('starts a fresh accumulator when message.id advances (new LLM turn)', () => {
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
          id: 'msg_2',
          content: [{ id: 't2', input: {}, name: 'Bash', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const chunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      // Different message.id — the new assistant's tools[] must NOT contain t1
      expect(chunk!.data.toolsCalling.map((t: any) => t.id)).toEqual(['t2']);
    });

    it('dedupes when CC echoes a tool_use block with the same id', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      // Same tool_use id re-sent — cumulative list must not duplicate it,
      // and tool_start must not fire again.
      const e2 = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: {}, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const chunk = e2.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk!.data.toolsCalling.map((t: any) => t.id)).toEqual(['t1']);
      expect(e2.filter((e) => e.type === 'tool_start')).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Partial-messages streaming (--include-partial-messages)
  // stream_event wrapper carries Anthropic SSE deltas:
  //   {type: 'message_start', message: {id, model}}
  //   {type: 'content_block_delta', delta: {type: 'text_delta', text}}
  //   {type: 'content_block_delta', delta: {type: 'thinking_delta', thinking}}
  // ──────────────────────────────────────────────────────────────

  describe('stream_event (partial messages)', () => {
    const init = { subtype: 'init' as const, type: 'system' as const };
    const delta = (type: string, field: string, value: string) => ({
      event: { delta: { [field]: value, type }, index: 0, type: 'content_block_delta' },
      type: 'stream_event',
    });
    const messageStart = (id: string, model?: string) => ({
      event: { message: { id, model }, type: 'message_start' },
      type: 'stream_event',
    });

    it('emits stream_chunk text on text_delta', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));

      const events = adapter.adapt(delta('text_delta', 'text', 'Hel'));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('stream_chunk');
      expect(events[0].data.chunkType).toBe('text');
      expect(events[0].data.content).toBe('Hel');
    });

    it('emits stream_chunk reasoning on thinking_delta', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));

      const events = adapter.adapt(delta('thinking_delta', 'thinking', 'pondering'));
      expect(events).toHaveLength(1);
      expect(events[0].data.chunkType).toBe('reasoning');
      expect(events[0].data.reasoning).toBe('pondering');
    });

    it('streams multiple deltas as separate chunks (gateway handler concatenates)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));

      const e1 = adapter.adapt(delta('text_delta', 'text', 'Hel'));
      const e2 = adapter.adapt(delta('text_delta', 'text', 'lo '));
      const e3 = adapter.adapt(delta('text_delta', 'text', 'world'));

      expect(e1[0].data.content).toBe('Hel');
      expect(e2[0].data.content).toBe('lo ');
      expect(e3[0].data.content).toBe('world');
    });

    it('suppresses handleAssistant text emission when deltas already streamed', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', 'Hello world'));

      // The trailing assistant event carries the full completed block.
      // It must NOT re-emit a giant "Hello world" chunk or the UI duplicates text.
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'Hello world', type: 'text' }] },
        type: 'assistant',
      });

      const textChunks = events.filter(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
      );
      expect(textChunks).toHaveLength(0);
    });

    it('suppresses handleAssistant thinking emission when thinking_delta already streamed', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('thinking_delta', 'thinking', 'reasoning...'));

      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ thinking: 'reasoning...', type: 'thinking' }] },
        type: 'assistant',
      });

      const reasoningChunks = events.filter(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
      );
      expect(reasoningChunks).toHaveLength(0);
    });

    it('still emits tool_use from assistant event even when text was streamed via deltas', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', "I'll read that file."));

      // Same message.id continues with a tool_use block — tool_use never streams
      // as delta (input_json_delta would be partial JSON), so handleAssistant
      // remains the source of truth for tool invocations.
      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 't1', input: { path: '/a' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const toolsChunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(toolsChunk).toBeDefined();
      expect(toolsChunk!.data.toolsCalling[0].id).toBe('t1');
    });

    it('still emits full text block if a later message.id has no deltas', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', 'streamed'));
      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'streamed', type: 'text' }] },
        type: 'assistant',
      });

      // Second LLM turn arrives without any stream_event deltas — must fall
      // back to the full-block emission so no content is dropped.
      const events = adapter.adapt({
        message: { id: 'msg_2', content: [{ text: 'no-delta reply', type: 'text' }] },
        type: 'assistant',
      });

      const textChunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
      );
      expect(textChunk).toBeDefined();
      expect(textChunk!.data.content).toBe('no-delta reply');
    });

    it('fires newStep on message_start when message.id changes', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      // First turn
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', 'first'));
      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'first', type: 'text' }] },
        type: 'assistant',
      });

      // Second turn — step boundary must fire at message_start, BEFORE the
      // deltas, or those deltas would be emitted with the stale stepIndex.
      const events = adapter.adapt(messageStart('msg_2', 'claude-sonnet-4-6'));

      const types = events.map((e) => e.type);
      expect(types).toContain('stream_end');
      const start = events.find((e) => e.type === 'stream_start');
      expect(start).toBeDefined();
      expect(start!.data.newStep).toBe(true);
    });

    it('emits deltas with the new stepIndex after message_start advances it', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', 'first'));
      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'first', type: 'text' }] },
        type: 'assistant',
      });

      adapter.adapt(messageStart('msg_2'));
      const chunk = adapter.adapt(delta('text_delta', 'text', 'second'));

      // After step boundary, stepIndex should be 1.
      expect(chunk[0].stepIndex).toBe(1);
    });

    it('ignores input_json_delta and other non-text/thinking delta types', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));

      const inputJson = adapter.adapt(delta('input_json_delta', 'partial_json', '{"path":'));
      expect(inputJson).toEqual([]);
    });

    it('ignores unknown stream_event event.type (content_block_start, message_stop, …)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));

      const blockStart = adapter.adapt({
        event: { content_block: { text: '', type: 'text' }, index: 0, type: 'content_block_start' },
        type: 'stream_event',
      });
      expect(blockStart).toEqual([]);

      const msgStop = adapter.adapt({ event: { type: 'message_stop' }, type: 'stream_event' });
      expect(msgStop).toEqual([]);
    });

    it('handles stream_event with no prior system init (auto-starts)', () => {
      const adapter = new ClaudeCodeAdapter();
      const events = adapter.adapt(messageStart('msg_1', 'claude-sonnet-4-6'));

      const start = events.find((e) => e.type === 'stream_start');
      expect(start).toBeDefined();
      expect(start!.data.model).toBe('claude-sonnet-4-6');
    });

    it('returns [] for malformed stream_event (missing event field)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      expect(adapter.adapt({ type: 'stream_event' })).toEqual([]);
      expect(adapter.adapt({ event: null, type: 'stream_event' })).toEqual([]);
    });
  });
});
