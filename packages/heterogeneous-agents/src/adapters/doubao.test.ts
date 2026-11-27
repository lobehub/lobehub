import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { DoubaoAdapter } from './doubao';

/**
 * Fixtures shaped from the event vocabulary found in doubao-cli 2.37.2's
 * `entry-cli-chat` bundle: system / assistant / user / result / stream_event,
 * with content_block_delta + text_delta inside stream_event.
 */
const initFrame = {
  model: 'doubao-seed-code',
  session_id: 'sess_doubao_1',
  subtype: 'init',
  type: 'system',
};

const textDeltaFrames = [
  {
    event: {
      delta: { text: 'Hello', type: 'text_delta' },
      index: 0,
      type: 'content_block_delta',
    },
    session_id: 'sess_doubao_1',
    type: 'stream_event',
  },
  {
    event: {
      delta: { text: ' world', type: 'text_delta' },
      index: 0,
      type: 'content_block_delta',
    },
    session_id: 'sess_doubao_1',
    type: 'stream_event',
  },
];

const assistantFrame = {
  message: {
    content: [{ text: 'Hello world', type: 'text' }],
    id: 'msg_1',
    role: 'assistant',
  },
  session_id: 'sess_doubao_1',
  type: 'assistant',
};

const resultFrame = {
  duration_ms: 1200,
  is_error: false,
  result: 'Hello world',
  session_id: 'sess_doubao_1',
  subtype: 'success',
  type: 'result',
};

const ofType = (events: HeterogeneousAgentEvent[], type: string) =>
  events.filter((e) => e.type === type);

const textOf = (events: HeterogeneousAgentEvent[]) =>
  events
    .filter((e) => e.type === 'stream_chunk')
    .map((c) => c.data?.content)
    .filter((v): v is string => typeof v === 'string')
    .join('');

describe('DoubaoAdapter', () => {
  it('emits stream_start for the system init frame', () => {
    const adapter = new DoubaoAdapter();
    const events = adapter.adapt(initFrame);
    expect(ofType(events, 'stream_start').length).toBeGreaterThan(0);
  });

  it('streams text deltas as chunks with text content', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt(initFrame);
    const chunks = textDeltaFrames.flatMap((f) => ofType(adapter.adapt(f), 'stream_chunk'));
    expect(chunks.length).toBeGreaterThan(0);
    expect(textOf(chunks)).toContain('Hello');
  });

  it('ends the operation on the result frame', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt(initFrame);
    for (const f of textDeltaFrames) adapter.adapt(f);
    adapter.adapt(assistantFrame);
    const events = adapter.adapt(resultFrame);
    const terminal = events.filter(
      (e) => e.type === 'stream_end' || e.type === 'agent_runtime_end',
    );
    expect(terminal.length).toBeGreaterThan(0);
  });

  it('suppresses the raw login_required echo so only a structured auth error surfaces', () => {
    const adapter = new DoubaoAdapter();
    expect(adapter.adapt('login_required: 当前未登录，请运行 `doubao login` 登录')).toEqual([]);
  });

  it('suppresses an auth failure carried on a result frame', () => {
    const adapter = new DoubaoAdapter();
    const events = adapter.adapt({
      is_error: true,
      result: 'login_required: 当前未登录，请运行 `doubao login` 登录',
      subtype: 'success',
      type: 'result',
    });
    expect(events).toEqual([]);
  });

  it('does not suppress ordinary frames', () => {
    const adapter = new DoubaoAdapter();
    expect(adapter.adapt(initFrame).length).toBeGreaterThan(0);
  });
});

/**
 * Captures below are verbatim stdout frames from doubao-cli 2.37.2 (linux-x64
 * native build) against a logged-in personal account, including the protocol
 * divergences from Claude Code this adapter exists to reconcile.
 */
describe('DoubaoAdapter – captured stream-json frames (2.37.2)', () => {
  it('adopts message_id from stream_event so the assistant echo is not rendered twice', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: '1234567890abcdef', subtype: 'init', type: 'system' });

    // Doubao puts message_id at the TOP LEVEL of stream_event and never emits
    // message_start, unlike Claude Code.
    const first = adapter.adapt({
      event: {
        delta: { text: 'Hello', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      message_id: '7654321',
      session_id: '1234567890abcdef',
      type: 'stream_event',
    });
    const second = adapter.adapt({
      event: {
        delta: { text: '! How can I help you today?', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      message_id: '7654321',
      session_id: '1234567890abcdef',
      type: 'stream_event',
    });

    // The closing assistant frame repeats the full text.
    const echo = adapter.adapt({
      message: {
        content: [{ text: 'Hello! How can I help you today?', type: 'text' }],
        id: '7654321',
        role: 'assistant',
      },
      session_id: '1234567890abcdef',
      type: 'assistant',
    });

    expect(textOf([...first, ...second])).toBe('Hello! How can I help you today?');
    // The echo must not add a second copy of the same text.
    expect(textOf(echo)).not.toContain('Hello');
  });

  it('flattens result.result from {type:text,content} instead of stringifying it', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: '1234567890abcdef', subtype: 'init', type: 'system' });

    const events = adapter.adapt({
      is_error: false,
      log_id: '20261125094006A1B2C3D4E5F6',
      message_id: '7654321',
      permission_denials: [],
      result: { content: 'There are 3 files.', type: 'text' },
      session_id: '1234567890abcdef',
      subtype: 'success',
      tool_calls_truncated: false,
      type: 'result',
    });

    const rendered = JSON.stringify(events);
    // Must never leak the raw payload shape into the transcript.
    expect(rendered).not.toContain('"content":"There are 3 files.","type":"text"');
    expect(rendered).not.toContain('\\"type\\":\\"text\\"');
  });

  it('recovers the answer when the run only delivers it on the terminal result frame', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: '1234567890abcdef', subtype: 'init', type: 'system' });

    const events = adapter.adapt({
      is_error: false,
      result: { content: 'Only the result frame carried this.', type: 'text' },
      session_id: '1234567890abcdef',
      subtype: 'success',
      type: 'result',
    });

    expect(textOf(events)).toContain('Only the result frame carried this.');
    // Text must be ordered before the terminal event.
    const types = events.map((e) => e.type);
    expect(types.indexOf('stream_chunk')).toBeLessThan(
      Math.max(types.indexOf('stream_end'), types.indexOf('agent_runtime_end')),
    );
  });

  it('does not duplicate text when deltas already carried it', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: '1234567890abcdef', subtype: 'init', type: 'system' });
    adapter.adapt({
      event: {
        delta: { text: 'Full answer', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      },
      message_id: '7654321',
      session_id: '1234567890abcdef',
      type: 'stream_event',
    });

    const events = adapter.adapt({
      is_error: false,
      result: { content: 'Full answer', type: 'text' },
      session_id: '1234567890abcdef',
      subtype: 'success',
      type: 'result',
    });

    expect(textOf(events)).not.toContain('Full answer');
  });

  it('maps tool_use and tool_result frames through the inherited state machine', () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: '1234567890abcdef', subtype: 'init', type: 'system' });

    const toolUse = adapter.adapt({
      message: {
        content: [
          {
            id: 'call_0',
            input: { command: 'ls -la' },
            input_status: 'available',
            name: 'Bash',
            type: 'tool_use',
          },
        ],
        id: '7654321:tool_use:call_0',
        role: 'assistant',
      },
      session_id: '1234567890abcdef',
      thread_id: 'thread_abc123',
      type: 'assistant',
    });
    expect(toolUse.length).toBeGreaterThan(0);

    const toolResult = adapter.adapt({
      message: {
        content: [
          {
            content: [{ text: 'total 24\n', type: 'text' }],
            content_status: 'available',
            is_error: false,
            tool_use_id: 'call_0',
            type: 'tool_result',
          },
        ],
        id: '7654321:tool_result:call_0',
        role: 'user',
      },
      session_id: '1234567890abcdef',
      thread_id: 'thread_abc123',
      type: 'user',
    });
    expect(JSON.stringify(toolResult)).toContain('call_0');
  });

  it('stamps every emitted event with the doubao identity, not claude-code', () => {
    const adapter = new DoubaoAdapter();
    const events = [
      ...adapter.adapt(initFrame),
      ...textDeltaFrames.flatMap((f) => adapter.adapt(f)),
      ...adapter.adapt(resultFrame),
    ];
    expect(JSON.stringify(events)).not.toContain('"claude-code"');
  });
});
