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

    it('emits visible_output_end before agent_runtime_end on success result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({ is_error: false, result: 'done', type: 'result' });
      expect(events.map((e) => e.type)).toEqual([
        'stream_end',
        'visible_output_end',
        'agent_runtime_end',
      ]);
    });

    it('emits error on failed result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({ is_error: true, result: 'boom', type: 'result' });
      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data.message).toBe('boom');
    });

    it('classifies auth failures from failed result events', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError =
        'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}';

      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({ is_error: true, result: rawError, type: 'result' });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({
        agentType: 'claude-code',
        clearEchoedContent: true,
        code: 'auth_required',
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
        stderr: rawError,
      });
      expect(events[2].data.message).toBe(
        'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
      );
    });

    it('classifies overloaded failures from api_error_status 529 result events', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError =
        'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({
        api_error_status: 529,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({
        agentType: 'claude-code',
        clearEchoedContent: true,
        code: 'overloaded',
        message: rawError,
        stderr: rawError,
      });
    });

    it('classifies overloaded failures from result text alone', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError = 'Overloaded';

      adapter.adapt({ subtype: 'init', type: 'system' });
      const events = adapter.adapt({
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({
        agentType: 'claude-code',
        code: 'overloaded',
        message: rawError,
      });
    });

    it('classifies a 429 "not your usage limit" server throttle as overloaded, not rate_limit', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError =
        'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited';

      adapter.adapt({ subtype: 'init', type: 'system' });
      // CC still emits a generic rate_limit_event (rejected, no resetsAt) for
      // this transient throttle — it must NOT tip the classifier toward the
      // user-facing usage-limit guide.
      adapter.adapt({
        rate_limit_info: { isUsingOverage: false, status: 'rejected' },
        type: 'rate_limit_event',
      });

      const events = adapter.adapt({
        api_error_status: 429,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({
        agentType: 'claude-code',
        clearEchoedContent: true,
        code: 'overloaded',
        message: rawError,
        stderr: rawError,
      });
    });

    it('treats a 429 with no reset window in rate_limit_event as overloaded, not rate_limit', () => {
      const adapter = new ClaudeCodeAdapter();
      // Generic "Rate limited" wording + a rate_limit_event that carries no
      // resetsAt / rateLimitType. The structured signal — not the 429 status
      // or the "rate limit" substring — decides: no reset window → transient
      // server throttle → overloaded.
      const rawError = 'API Error: 429 · Rate limited';

      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        rate_limit_info: { status: 'rejected' },
        type: 'rate_limit_event',
      });

      const events = adapter.adapt({
        api_error_status: 429,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({ code: 'overloaded', message: rawError });
    });

    it('replays a real session that streamed a turn then overloaded → overloaded + clears echo', () => {
      // Faithful transport-layer replay of a captured CC session shape: init →
      // a streamed assistant turn → the exact upstream throttle the user hit
      // (api_error_status 429 + the "not your usage limit" wording, alongside a
      // generic rate_limit_event with no reset window). This is how the
      // overloaded guide is driven without waiting on a real upstream outage.
      const adapter = new ClaudeCodeAdapter();
      const rawError =
        'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited';

      adapter.adapt({
        model: 'claude-opus-4-8',
        session_id: 'sess_replay',
        subtype: 'init',
        type: 'system',
      });
      // A turn that already streamed content before the throttle landed.
      adapter.adapt({
        message: {
          content: [{ text: 'Let me read loadEvidence and the runner', type: 'text' }],
          id: 'msg_replay',
          role: 'assistant',
        },
        type: 'assistant',
      });
      adapter.adapt({
        rate_limit_info: { isUsingOverage: false, status: 'rejected' },
        type: 'rate_limit_event',
      });

      const events = adapter.adapt({
        api_error_status: 429,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent?.data).toMatchObject({
        agentType: 'claude-code',
        // The UI keys auto-retry on this exact code; clearEchoedContent wipes
        // the half-streamed turn so the guide stands in for the whole bubble.
        clearEchoedContent: true,
        code: 'overloaded',
        message: rawError,
      });
    });

    it('classifies a user quota limit from rateLimitType alone (no resetsAt)', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError = 'API Error: 429 · Rate limited';

      adapter.adapt({ subtype: 'init', type: 'system' });
      // rateLimitType is itself a user-quota signal even without resetsAt.
      adapter.adapt({
        rate_limit_info: { rateLimitType: 'seven_day', status: 'rejected' },
        type: 'rate_limit_event',
      });

      const events = adapter.adapt({
        api_error_status: 429,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events[2].data).toMatchObject({
        code: 'rate_limit',
        rateLimitInfo: { rateLimitType: 'seven_day' },
      });
    });

    it('does not treat an allowed rate_limit_event window as a quota limit on a later network error', () => {
      const adapter = new ClaudeCodeAdapter();
      // CC stamps a rate_limit_info onto an *allowed* request — it carries the
      // rolling-window metadata (resetsAt / rateLimitType) even though nothing
      // was rejected. A later ECONNRESET must surface as a generic error, NOT
      // inherit this window and render a bogus "usage limit reached" guide.
      const rawError = 'API Error: Unable to connect to API (ECONNRESET)';

      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        rate_limit_info: {
          isUsingOverage: false,
          rateLimitType: 'five_hour',
          resetsAt: 1_781_853_000,
          status: 'allowed',
        },
        type: 'rate_limit_event',
      });

      const events = adapter.adapt({
        api_error_status: null,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({ error: rawError, message: rawError });
      expect(events[2].data).not.toHaveProperty('code', 'rate_limit');
      expect(events[2].data).not.toHaveProperty('rateLimitInfo');
    });

    it('classifies rate-limit failures from paired rate_limit_event + result events', () => {
      const adapter = new ClaudeCodeAdapter();
      const rawError = "You've hit your limit · resets 9am (Asia/Shanghai)";

      adapter.adapt({ subtype: 'init', type: 'system' });
      expect(
        adapter.adapt({
          rate_limit_info: {
            isUsingOverage: false,
            overageDisabledReason: 'org_level_disabled',
            overageStatus: 'rejected',
            rateLimitType: 'seven_day',
            resetsAt: 1_776_992_400,
            status: 'rejected',
          },
          type: 'rate_limit_event',
        }),
      ).toEqual([]);

      const events = adapter.adapt({
        api_error_status: 429,
        is_error: true,
        result: rawError,
        type: 'result',
      });

      expect(events.map((e) => e.type)).toEqual(['stream_end', 'visible_output_end', 'error']);
      expect(events[2].data).toMatchObject({
        agentType: 'claude-code',
        clearEchoedContent: true,
        code: 'rate_limit',
        message: rawError,
        rateLimitInfo: {
          isUsingOverage: false,
          overageDisabledReason: 'org_level_disabled',
          overageStatus: 'rejected',
          rateLimitType: 'seven_day',
          resetsAt: 1_776_992_400,
          status: 'rejected',
        },
        stderr: rawError,
      });
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

    it('rewrites mcp__lobe_cc__ask_user_question to apiName=askUserQuestion', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const askInput = {
        questions: [
          {
            header: 'Color',
            options: [
              { description: 'Red', label: 'Red' },
              { description: 'Blue', label: 'Blue' },
            ],
            question: 'Pick a color?',
          },
        ],
      };

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            {
              id: 'tu_aq_1',
              input: askInput,
              name: 'mcp__lobe_cc__ask_user_question',
              type: 'tool_use',
            },
          ],
        },
        type: 'assistant',
      });

      const chunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(chunk!.data.toolsCalling).toEqual([
        {
          // Wire-prefixed name is rewritten to the stable domain key.
          apiName: 'askUserQuestion',
          arguments: JSON.stringify(askInput),
          id: 'tu_aq_1',
          identifier: 'claude-code',
          type: 'default',
        },
      ]);
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

  describe('ToolSearch tool_reference content ()', () => {
    // CC CLI serializes ToolSearch results as `tool_reference` blocks — no
    // `text` or `content` field — which the generic array mapper dropped to
    // empty content, leaving the tool message in DB with `content: ''` and
    // the UI's StatusIndicator stuck on the spinner.
    it('joins tool_reference blocks into newline-separated tool names', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            { id: 'ts1', input: { query: 'linear' }, name: 'ToolSearch', type: 'tool_use' },
          ],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [
                { tool_name: 'mcp__claude_ai_Linear__create_attachment', type: 'tool_reference' },
                { tool_name: 'mcp__claude_ai_Linear__create_document', type: 'tool_reference' },
                { tool_name: 'mcp__claude_ai_Linear__create_issue_label', type: 'tool_reference' },
              ],
              tool_use_id: 'ts1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result).toBeDefined();
      expect(result!.data.toolCallId).toBe('ts1');
      expect(result!.data.content).toBe(
        [
          'mcp__claude_ai_Linear__create_attachment',
          'mcp__claude_ai_Linear__create_document',
          'mcp__claude_ai_Linear__create_issue_label',
        ].join('\n'),
      );
      expect(result!.data.isError).toBe(false);

      const end = events.find((e) => e.type === 'tool_end');
      expect(end).toBeDefined();
      expect(end!.data.toolCallId).toBe('ts1');
    });

    it('mixes tool_reference with text blocks in a single tool_result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            { id: 'ts1', input: { query: 'search' }, name: 'ToolSearch', type: 'tool_use' },
          ],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [
                { text: 'Loaded:', type: 'text' },
                { tool_name: 'WebSearch', type: 'tool_reference' },
              ],
              tool_use_id: 'ts1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.content).toBe('Loaded:\nWebSearch');
    });

    it('skips tool_reference entries with no tool_name', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 'ts1', input: { query: 'x' }, name: 'ToolSearch', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [
                { tool_name: 'A', type: 'tool_reference' },
                { type: 'tool_reference' },
                { tool_name: 'B', type: 'tool_reference' },
              ],
              tool_use_id: 'ts1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.content).toBe('A\nB');
    });
  });

  describe('Read tool image content ()', () => {
    // CC's `Read` on images returns a `tool_result` whose `content` is an
    // `image` block (base64). The generic mapper had no branch for it so
    // resultContent collapsed to '' and the UI's StatusIndicator stuck on the
    // spinner ( minimal fix: emit an `[Image: …]` content placeholder).
    //  keeps that placeholder as the human-readable fallback AND
    // preserves the base64 body on `pluginState.images` so the runtime
    // pipeline can upload it and the UI can echo a thumbnail.
    it('renders image blocks as a non-empty placeholder and preserves base64 on pluginState.images', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 'r1', input: { file_path: 'x.png' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [
                {
                  source: { data: 'AAAA', media_type: 'image/png', type: 'base64' },
                  type: 'image',
                },
              ],
              tool_use_id: 'r1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result).toBeDefined();
      expect(result!.data.toolCallId).toBe('r1');
      expect(result!.data.content).toBe('[Image: image/png]');
      expect(result!.data.isError).toBe(false);
      expect(result!.data.pluginState.images).toEqual([
        { data: 'AAAA', mediaType: 'image/png' },
      ]);

      const end = events.find((e) => e.type === 'tool_end');
      expect(end).toBeDefined();
      expect(end!.data.toolCallId).toBe('r1');
    });

    it('falls back to generic label when media_type is missing', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 'r1', input: { file_path: 'x' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [
            {
              content: [{ source: { data: 'AAAA', type: 'base64' }, type: 'image' }],
              tool_use_id: 'r1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.content).toBe('[Image: image]');
      expect(result!.data.pluginState.images).toEqual([{ data: 'AAAA', mediaType: 'image' }]);
    });

    it('does not set pluginState.images for a text-only tool_result', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ id: 'r1', input: { file_path: 'x.ts' }, name: 'Read', type: 'tool_use' }],
        },
        type: 'assistant',
      });

      const events = adapter.adapt({
        message: {
          content: [{ content: 'plain text', tool_use_id: 'r1', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.content).toBe('plain text');
      expect(result!.data.pluginState).toBeUndefined();
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
        | {
            todos: {
              items: Array<{ id?: string; status: string; text: string }>;
              updatedAt: string;
            };
          }
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

  describe('Task tools pluginState synthesis (CC 2.1.143+)', () => {
    // Helper: drive a TaskCreate (assistant tool_use → user tool_result).
    // Returns the synthesized pluginState (or undefined) from the tool_result event.
    const driveTaskCreate = (
      adapter: ClaudeCodeAdapter,
      input: { activeForm?: string; description?: string; subject: string },
      toolId: string,
      resultContent: string,
      msgId: string,
      opts?: { isError?: boolean },
    ) => {
      adapter.adapt({
        message: {
          id: msgId,
          content: [{ id: toolId, input, name: 'TaskCreate', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [
            {
              content: resultContent,
              is_error: opts?.isError,
              tool_use_id: toolId,
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });
      return events.find((e) => e.type === 'tool_result')!.data.pluginState as
        | {
            todos: {
              items: Array<{ id?: string; status: string; text: string }>;
              updatedAt: string;
            };
          }
        | undefined;
    };

    const driveTaskUpdate = (
      adapter: ClaudeCodeAdapter,
      input: {
        activeForm?: string;
        description?: string;
        status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
        subject?: string;
        taskId: string;
      },
      toolId: string,
      resultContent: string,
      msgId: string,
      opts?: { isError?: boolean },
    ) => {
      adapter.adapt({
        message: {
          id: msgId,
          content: [{ id: toolId, input, name: 'TaskUpdate', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [
            {
              content: resultContent,
              is_error: opts?.isError,
              tool_use_id: toolId,
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        type: 'user',
      });
      return events.find((e) => e.type === 'tool_result')!.data.pluginState as
        | {
            todos: {
              items: Array<{ id?: string; status: string; text: string }>;
              updatedAt: string;
            };
          }
        | undefined;
    };

    const driveTaskList = (
      adapter: ClaudeCodeAdapter,
      toolId: string,
      resultContent: string,
      msgId: string,
    ) => {
      adapter.adapt({
        message: {
          id: msgId,
          content: [{ id: toolId, input: {}, name: 'TaskList', type: 'tool_use' }],
        },
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [{ content: resultContent, tool_use_id: toolId, type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });
      return events.find((e) => e.type === 'tool_result')!.data.pluginState as
        | {
            todos: {
              items: Array<{ id?: string; status: string; text: string }>;
              updatedAt: string;
            };
          }
        | undefined;
    };

    it('accumulates TaskCreate calls into pluginState ordered by CC-assigned id', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const after1 = driveTaskCreate(
        adapter,
        { activeForm: 'Reading hosts', description: 'Read /etc/hosts', subject: 'Read hosts' },
        'tu_create_1',
        'Task #1 created successfully: Read hosts',
        'msg_1',
      );
      expect(after1!.todos.items).toEqual([{ id: '1', status: 'todo', text: 'Read hosts' }]);

      const after2 = driveTaskCreate(
        adapter,
        { activeForm: 'Counting lines', description: 'Count lines', subject: 'Count lines' },
        'tu_create_2',
        'Task #2 created successfully: Count lines',
        'msg_2',
      );
      expect(after2!.todos.items).toEqual([
        { id: '1', status: 'todo', text: 'Read hosts' },
        { id: '2', status: 'todo', text: 'Count lines' },
      ]);
    });

    it('uses activeForm for in_progress items and subject for the rest', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      driveTaskCreate(
        adapter,
        { activeForm: 'Reading hosts', description: 'Read /etc/hosts', subject: 'Read hosts' },
        'tu_create_1',
        'Task #1 created successfully: Read hosts',
        'msg_1',
      );

      const afterUpdate = driveTaskUpdate(
        adapter,
        { status: 'in_progress', taskId: '1' },
        'tu_update_1',
        'Updated task #1 status',
        'msg_2',
      );
      expect(afterUpdate!.todos.items).toEqual([
        { id: '1', status: 'processing', text: 'Reading hosts' },
      ]);

      const afterDone = driveTaskUpdate(
        adapter,
        { status: 'completed', taskId: '1' },
        'tu_update_2',
        'Updated task #1 status',
        'msg_3',
      );
      expect(afterDone!.todos.items).toEqual([
        { id: '1', status: 'completed', text: 'Read hosts' },
      ]);
    });

    it('falls back to subject for in_progress when activeForm was never set', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      driveTaskCreate(
        adapter,
        { description: 'Read /etc/hosts', subject: 'Read hosts' },
        'tu_create_1',
        'Task #1 created successfully: Read hosts',
        'msg_1',
      );

      const state = driveTaskUpdate(
        adapter,
        { status: 'in_progress', taskId: '1' },
        'tu_update_1',
        'Updated task #1 status',
        'msg_2',
      );
      expect(state!.todos.items).toEqual([{ id: '1', status: 'processing', text: 'Read hosts' }]);
    });

    it('TaskUpdate with status: deleted removes the entry', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      driveTaskCreate(
        adapter,
        { description: 'A', subject: 'A' },
        'tu_create_1',
        'Task #1 created successfully: A',
        'msg_1',
      );
      driveTaskCreate(
        adapter,
        { description: 'B', subject: 'B' },
        'tu_create_2',
        'Task #2 created successfully: B',
        'msg_2',
      );

      const state = driveTaskUpdate(
        adapter,
        { status: 'deleted', taskId: '1' },
        'tu_update_del',
        'Updated task #1',
        'msg_3',
      );
      expect(state!.todos.items).toEqual([{ id: '2', status: 'todo', text: 'B' }]);
    });

    it('does NOT mutate accumulator when TaskCreate tool_result is is_error', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      driveTaskCreate(
        adapter,
        { description: 'A', subject: 'A' },
        'tu_create_1',
        'Task #1 created successfully: A',
        'msg_1',
      );

      const errorState = driveTaskCreate(
        adapter,
        { description: 'B', subject: 'B' },
        'tu_create_2',
        'Invalid subject',
        'msg_2',
        { isError: true },
      );
      // Error path returns no pluginState — UI keeps the prior snapshot.
      expect(errorState).toBeUndefined();

      // A later successful create must not inherit the failed create's
      // cached input — the cache should have been drained.
      const next = driveTaskCreate(
        adapter,
        { description: 'C', subject: 'C' },
        'tu_create_3',
        'Task #3 created successfully: C',
        'msg_3',
      );
      // Only entries: #1 (A, todo) and #3 (C, todo). #2 must NOT appear.
      expect(next!.todos.items).toEqual([
        { id: '1', status: 'todo', text: 'A' },
        { id: '3', status: 'todo', text: 'C' },
      ]);
    });

    it('TaskUpdate to a never-seen id seeds a placeholder so resume sessions still render', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // Resume gap: no prior TaskCreate observed. The update should still
      // produce an entry, falling back to a synthetic subject until a
      // TaskList reconcile fills it in.
      const state = driveTaskUpdate(
        adapter,
        { status: 'in_progress', subject: 'Recovered subject', taskId: '7' },
        'tu_update_orphan',
        'Updated task #7 status',
        'msg_1',
      );
      expect(state!.todos.items).toEqual([
        { id: '7', status: 'processing', text: 'Recovered subject' },
      ]);
    });

    it('TaskList rebuilds entries from plain-text output when the accumulator is empty', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      const state = driveTaskList(
        adapter,
        'tu_list_1',
        '#1 [in_progress] Read hosts\n#2 [pending] Count lines\n#3 [completed] Report',
        'msg_1',
      );
      expect(state!.todos.items).toEqual([
        { id: '1', status: 'processing', text: 'Read hosts' },
        { id: '2', status: 'todo', text: 'Count lines' },
        { id: '3', status: 'completed', text: 'Report' },
      ]);
    });

    it('TaskList preserves activeForm from earlier TaskCreate when reconciling', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      driveTaskCreate(
        adapter,
        { activeForm: 'Reading hosts', description: 'Read', subject: 'Read hosts' },
        'tu_create_1',
        'Task #1 created successfully: Read hosts',
        'msg_1',
      );
      // TaskList output flips status to in_progress; activeForm should
      // survive the reconcile (TaskList itself doesn't carry it).
      const state = driveTaskList(adapter, 'tu_list_1', '#1 [in_progress] Read hosts', 'msg_2');
      expect(state!.todos.items).toEqual([
        { id: '1', status: 'processing', text: 'Reading hosts' },
      ]);
    });

    it('does not synthesize Task pluginState for subagent tool_results', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // Subagent assistant carrying a TaskCreate (parent_tool_use_id set).
      adapter.adapt({
        message: {
          id: 'msg_sub_1',
          content: [
            {
              id: 'tu_sub_create',
              input: { description: 'Sub task', subject: 'Sub task' },
              name: 'TaskCreate',
              type: 'tool_use',
            },
          ],
        },
        parent_tool_use_id: 'tu_main_agent',
        type: 'assistant',
      });
      const events = adapter.adapt({
        message: {
          content: [
            {
              content: 'Task #99 created successfully: Sub task',
              tool_use_id: 'tu_sub_create',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        parent_tool_use_id: 'tu_main_agent',
        type: 'user',
      });
      const result = events.find((e) => e.type === 'tool_result');
      // Subagent task tools are out-of-scope for the main todo plan UI.
      expect(result!.data.pluginState).toBeUndefined();
    });

    it('mixed TodoWrite + Task* flows are independent (TodoWrite path still wins on its own call)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // First, a TaskCreate snapshot.
      driveTaskCreate(
        adapter,
        { description: 'A', subject: 'A' },
        'tu_create_1',
        'Task #1 created successfully: A',
        'msg_1',
      );

      // Then a TodoWrite from a legacy / resumed session — should produce
      // its own pluginState from its own input, NOT the Task accumulator.
      adapter.adapt({
        message: {
          id: 'msg_2',
          content: [
            {
              id: 'tu_todo',
              input: { todos: [{ activeForm: 'Doing X', content: 'X', status: 'completed' }] },
              name: 'TodoWrite',
              type: 'tool_use',
            },
          ],
        },
        type: 'assistant',
      });
      const todoEvents = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 'tu_todo', type: 'tool_result' }],
          role: 'user',
        },
        type: 'user',
      });
      const todoState = todoEvents.find((e) => e.type === 'tool_result')!.data.pluginState;
      expect(todoState.todos.items).toEqual([{ status: 'completed', text: 'X' }]);
    });
  });

  describe('multi-step execution (message.id boundary)', () => {
    it('does NOT emit step boundary for the first assistant after init', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', session_id: 'sess-A', type: 'system' });

      // First assistant message after init — should NOT open a new step
      // (no stream_end, no newStep), but it DOES emit a non-newStep stream_start
      // carrying the turn's message.id so the reducer can stamp it as
      // `currentMainMessageId` (→ heteroMessageId on the seeded assistant).
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'step 1', type: 'text' }] },
        type: 'assistant',
      });

      const types = events.map((e) => e.type);
      expect(types).not.toContain('stream_end');
      const streamStart = events.find((e) => e.type === 'stream_start');
      expect(streamStart).toBeDefined();
      expect(streamStart!.data.newStep).toBeUndefined();
      expect(streamStart!.data.messageId).toBe('msg_1');
      expect(streamStart!.data.sessionId).toBe('sess-A');
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

    // ── Regression: post-tool text must not coalesce onto the tool-issuing turn ──
    // Observed on a DEVICE (batch / `lh hetero exec`) Claude Code run — topic
    // tpc_58GZ5d8NGPLx, assistant msg_orSJYzAH9HEL9Gb4k3. That run persisted the
    // final answer text AND the 2 Bash `tool_use` blocks onto a SINGLE assistant
    // message (the tool-issuing seed, no `metadata.mainMessageId`), while a
    // trailing EMPTY assistant shell (msg_MUtsnMCWkbtBwcLlAH — content_len=0,
    // `metadata.mainMessageId` set) was spawned. Downstream the renderer then
    // drops the "Bash (2)" block BELOW the answer because text + tool_use share
    // one message.
    //
    // Proximate cause: when CC reuses a `message.id` to stream the post-tool
    // continuation (the model answering after a `tool_result`), the
    // `messageId === this.currentMessageId` short-circuit in `openMainMessage`
    // returns `[]` → no `newStep` → the text anchors to the same assistant that
    // issued the tool calls. A turn that has ALREADY emitted `tool_use` must open
    // a new step before absorbing post-tool text, so the answer lands on its own
    // assistant (chained after the tool results).
    //
    // Fixed in `openMainMessage` / `handleAssistant`: a text-only event on the
    // in-flight message.id that already emitted a tool_use now forces a step
    // boundary so the answer anchors to its own assistant.
    it('opens a new step for post-tool text that reuses the tool_use message.id (regression: tpc_58GZ5d8NGPLx)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // 1. Assistant issues a tool_use under msg_1.
      adapter.adapt({
        message: {
          id: 'msg_1',
          content: [
            { id: 'tu_1', input: { command: 'mock command' }, name: 'Bash', type: 'tool_use' },
          ],
        },
        type: 'assistant',
      });

      // 2. Tool returns.
      adapter.adapt({
        message: {
          content: [{ content: 'mock tool output', tool_use_id: 'tu_1', type: 'tool_result' }],
        },
        type: 'user',
      });

      // 3. Model continues with the final answer — CC REUSES msg_1 for this
      //    post-tool text instead of minting a fresh message.id.
      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'mock post-tool answer', type: 'text' }] },
        type: 'assistant',
      });

      // Desired: a step boundary precedes the post-tool text so it anchors to a
      // NEW assistant, not the tool-issuing turn.
      const newStep = events.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(newStep).toBeDefined();
    });

    // The forced split above must NOT reuse the tool turn's message.id as the
    // newStep id: the main-agent reducer drops a `newStep` whose id equals the
    // already-open turn's `currentMainMessageId` (replay idempotency). For any
    // tool turn that was itself opened by a prior newStep, that id IS
    // currentMainMessageId — reusing it would get the split dropped and the text
    // would coalesce anyway. The first reused-id regression above only escaped
    // this because the seed turn has no mainMessageId. Here the tool turn (msg_2)
    // is opened by a real newStep, so the split must carry a DISTINCT key.
    it('uses a key distinct from the tool turn id when forcing a post-tool split on a non-seed turn', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });

      // First turn after init (records msg_1, no step boundary).
      adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'mock first turn', type: 'text' }] },
        type: 'assistant',
      });

      // Second turn (NEW id) — opened by a real newStep, so the reducer's
      // currentMainMessageId becomes msg_2. This turn issues a tool_use.
      adapter.adapt({
        message: {
          id: 'msg_2',
          content: [
            { id: 'tu_1', input: { command: 'mock command' }, name: 'Bash', type: 'tool_use' },
          ],
        },
        type: 'assistant',
      });
      adapter.adapt({
        message: {
          content: [{ content: 'mock tool output', tool_use_id: 'tu_1', type: 'tool_result' }],
        },
        type: 'user',
      });

      // Post-tool answer reuses msg_2.
      const events = adapter.adapt({
        message: { id: 'msg_2', content: [{ text: 'mock post-tool answer', type: 'text' }] },
        type: 'assistant',
      });

      const newStep = events.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(newStep).toBeDefined();
      // Distinct from the reused id (else the reducer drops it as a replay)…
      expect(newStep!.data.messageId).not.toBe('msg_2');
      // …but derived from it, so the key stays traceable + replay-stable.
      expect(newStep!.data.messageId).toMatch(/^msg_2:/);
    });
  });

  describe('usage and model extraction', () => {
    // Under `--include-partial-messages` (partial mode), CC emits a stale
    // `message_start.usage` snapshot (e.g. `output_tokens: 8`) that it echoes
    // verbatim on every content-block `assistant` event. The authoritative
    // per-turn total only arrives later as `message_delta`. So in partial mode
    // turn_metadata emission is wired to `message_delta`, not `assistant`.
    // Seeing a `stream_event` is what tells the adapter it is in partial mode.
    it('does NOT emit turn_metadata on assistant events in partial mode (usage there is stale)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt({ subtype: 'init', type: 'system' });
      // A stream_event marks partial mode — message_delta will own usage.
      adapter.adapt({
        event: { message: { id: 'msg_1', model: 'claude-sonnet-4-6' }, type: 'message_start' },
        type: 'stream_event',
      });

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

    // BATCH mode (no `--include-partial-messages`, e.g. the `lh hetero exec`
    // CLI used by device + sandbox runs): no `message_delta` arrives, and the
    // `assistant` event's usage is authoritative — not a stale echo. The
    // adapter must emit turn_metadata here so token counts land, carrying the
    // clean `assistant` model id (NOT the `[1m]` beta-tagged `system init` one).
    it('emits turn_metadata on assistant events in batch mode (no stream_event)', () => {
      const adapter = new ClaudeCodeAdapter();
      // `system init` reports the beta-tagged id; the assistant event is clean.
      adapter.adapt({ model: 'claude-opus-4-8[1m]', subtype: 'init', type: 'system' });

      const events = adapter.adapt({
        message: {
          id: 'msg_1',
          content: [{ text: 'hello', type: 'text' }],
          model: 'claude-opus-4-8',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        type: 'assistant',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta).toBeDefined();
      expect(meta!.data.model).toBe('claude-opus-4-8');
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

    it('returns empty array for unknown event types', () => {
      const adapter = new ClaudeCodeAdapter();
      const events = adapter.adapt({ type: 'something_unexpected', data: {} });
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

    it('emits only the missing text suffix when the final assistant block is longer than streamed deltas', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', '修'));

      const events = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: '修复完成', type: 'text' }] },
        type: 'assistant',
      });

      const textChunks = events.filter(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
      );
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].data.content).toBe('复完成');
      expect((adapter as any).streamedTextByMessageId.has('msg_1')).toBe(false);
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

    it('keeps the other modality dedupe state when assistant blocks reconcile separately', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(messageStart('msg_1'));
      adapter.adapt(delta('text_delta', 'text', 'hello'));
      adapter.adapt(delta('thinking_delta', 'thinking', 'pondering'));

      const textEvents = adapter.adapt({
        message: { id: 'msg_1', content: [{ text: 'hello', type: 'text' }] },
        type: 'assistant',
      });
      const thinkingEvents = adapter.adapt({
        message: { id: 'msg_1', content: [{ thinking: 'pondering', type: 'thinking' }] },
        type: 'assistant',
      });

      expect(
        textEvents.filter((e) => e.type === 'stream_chunk' && e.data.chunkType === 'text'),
      ).toHaveLength(0);
      expect(
        thinkingEvents.filter((e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning'),
      ).toHaveLength(0);
      expect((adapter as any).streamedTextByMessageId.has('msg_1')).toBe(false);
      expect((adapter as any).streamedThinkingByMessageId.has('msg_1')).toBe(false);
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

  // ──────────────────────────────────────────────────────────────
  // Subagent lineage (Claude Code Agent-tool spawned flows)
  // Shape reference: .heerogeneous-tracing/cc-streaming.json
  //   main agent emits tool_use {name:'Agent', id:'toolu_parent'}
  //   subagent events carry raw.parent_tool_use_id = 'toolu_parent'
  //   subagent message.id differs from main agent's per turn
  // ──────────────────────────────────────────────────────────────

  describe('subagent lineage', () => {
    const init = { subtype: 'init' as const, type: 'system' as const };
    const mainAssistant = (id: string, toolUse: any) => ({
      message: { content: [toolUse], id },
      type: 'assistant',
    });
    const subAgent = (id: string, parent: string, block: any) => ({
      message: { content: [block], id },
      parent_tool_use_id: parent,
      type: 'assistant',
    });

    it('emits subagent context as peer field on the chunk (NOT on ToolCallPayload)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Task',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_parent', {
          id: 'toolu_child',
          input: { command: 'ls' },
          name: 'Bash',
          type: 'tool_use',
        }),
      );

      const toolsChunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(toolsChunk).toBeDefined();
      // Peer field on chunk data — describes the whole chunk's origin
      expect(toolsChunk!.data.subagent).toMatchObject({
        parentToolCallId: 'toolu_parent',
        subagentMessageId: 'msg_sub_1',
      });
      // Payload stays minimal — no lineage inside the tool call
      const tool = toolsChunk!.data.toolsCalling[0];
      expect(tool.id).toBe('toolu_child');
      expect(tool).not.toHaveProperty('parentToolCallId');
      expect(tool).not.toHaveProperty('subagentSpawn');
    });

    it('does NOT emit stream_end / newStep when subagent introduces new message.id', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_parent', {
          id: 'toolu_child',
          input: {},
          name: 'Read',
          type: 'tool_use',
        }),
      );

      expect(events.some((e) => e.type === 'stream_end')).toBe(false);
      const starts = events.filter((e) => e.type === 'stream_start');
      // No newStep stream_start for subagent turn transitions
      expect(starts.some((e) => e.data?.newStep)).toBe(false);
    });

    it('emits subagent-tagged turn_metadata step_complete carrying message.usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt({
        message: {
          content: [{ id: 'toolu_child', input: {}, name: 'Bash', type: 'tool_use' }],
          id: 'msg_sub',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 5, output_tokens: 10 },
        },
        parent_tool_use_id: 'toolu_parent',
        type: 'assistant',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta).toBeDefined();
      // Subagent ctx tag is what stops the executor from writing this usage
      // onto the main agent (which would double-count vs the result event).
      expect(meta?.data?.subagent?.parentToolCallId).toBe('toolu_parent');
      expect(meta?.data?.subagent?.subagentMessageId).toBe('msg_sub');
      expect(meta?.data?.model).toBe('claude-sonnet-4-6');
      expect(meta?.data?.usage?.totalInputTokens).toBe(5);
      expect(meta?.data?.usage?.totalOutputTokens).toBe(10);
    });

    it('does NOT emit turn_metadata for subagent events without message.usage', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt({
        message: {
          content: [{ id: 'toolu_child', input: {}, name: 'Bash', type: 'tool_use' }],
          id: 'msg_sub',
          model: 'claude-sonnet-4-6',
        },
        parent_tool_use_id: 'toolu_parent',
        type: 'assistant',
      });

      const meta = events.find(
        (e) => e.type === 'step_complete' && e.data?.phase === 'turn_metadata',
      );
      expect(meta).toBeUndefined();
    });

    it('emits subagent text/reasoning as chunks with subagent peer (NOT into main bubble)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt(
        subAgent('msg_sub', 'toolu_parent', { text: 'sub summary', type: 'text' }),
      );

      const textChunks = events.filter(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'text',
      );
      // Text is now emitted so the thread view can show the subagent's
      // closing summary. Critically, each chunk carries the `subagent`
      // peer field — the executor routes these to the in-thread
      // assistant's content, NOT to the main assistant's accumulator.
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].data.content).toBe('sub summary');
      expect(textChunks[0].data.subagent).toMatchObject({
        parentToolCallId: 'toolu_parent',
        subagentMessageId: 'msg_sub',
      });
    });

    it('emits subagent reasoning (thinking) with subagent peer', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt(
        subAgent('msg_sub', 'toolu_parent', {
          thinking: 'weighing the options',
          type: 'thinking',
        }),
      );

      const reasoningChunks = events.filter(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
      );
      expect(reasoningChunks).toHaveLength(1);
      expect(reasoningChunks[0].data.reasoning).toBe('weighing the options');
      expect(reasoningChunks[0].data.subagent?.parentToolCallId).toBe('toolu_parent');
    });

    it('resumes main-agent step boundary AFTER subagent completes', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main_1', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );
      // Subagent runs (no step boundaries)
      adapter.adapt(
        subAgent('msg_sub_1', 'toolu_parent', {
          id: 'toolu_child_1',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );
      adapter.adapt(
        subAgent('msg_sub_2', 'toolu_parent', {
          id: 'toolu_child_2',
          input: {},
          name: 'Read',
          type: 'tool_use',
        }),
      );

      // Main agent resumes with a new message.id and no parent — SHOULD fire newStep
      const events = adapter.adapt({
        message: {
          content: [{ text: 'follow-up', type: 'text' }],
          id: 'msg_main_2',
        },
        type: 'assistant',
      });

      expect(events.some((e) => e.type === 'stream_end')).toBe(true);
      expect(events.some((e) => e.type === 'stream_start' && e.data?.newStep)).toBe(true);
    });

    it('tool_result events for subagent tools still propagate to executor', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_parent',
          input: {},
          name: 'Agent',
          type: 'tool_use',
        }),
      );
      adapter.adapt(
        subAgent('msg_sub', 'toolu_parent', {
          id: 'toolu_child',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );

      const events = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 'toolu_child', type: 'tool_result' }],
        },
        parent_tool_use_id: 'toolu_parent',
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result).toBeDefined();
      expect(result!.data.toolCallId).toBe('toolu_child');
    });

    it('stamps spawnMetadata on the FIRST subagent event only (lazy Thread create)', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      // Main agent emits the Task tool_use — adapter caches its args
      // for the upcoming subagent announcement.
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_task',
          input: {
            description: 'Find failing tests',
            prompt: 'run the suite and list failures',
            subagent_type: 'Explore',
          },
          name: 'Task',
          type: 'tool_use',
        }),
      );

      // First subagent event — carries spawnMetadata
      const first = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_task', {
          id: 'toolu_child_1',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );
      const firstChunk = first.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(firstChunk!.data.subagent.spawnMetadata).toEqual({
        description: 'Find failing tests',
        prompt: 'run the suite and list failures',
        subagentType: 'Explore',
      });

      // Second subagent event for same parent — lineage preserved, but
      // spawnMetadata is absent (executor already created the Thread).
      const second = adapter.adapt(
        subAgent('msg_sub_2', 'toolu_task', {
          id: 'toolu_child_2',
          input: {},
          name: 'Read',
          type: 'tool_use',
        }),
      );
      const secondChunk = second.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(secondChunk!.data.subagent.parentToolCallId).toBe('toolu_task');
      expect(secondChunk!.data.subagent.spawnMetadata).toBeUndefined();
    });

    it('stamps spawnMetadata on a reasoning-FIRST subagent event (titles the Thread correctly)', () => {
      // A thinking Explore agent reasons before its first tool call. The
      // executor lazy-creates + titles the Thread off the FIRST subagent event
      // it sees, so the metadata must ride the reasoning chunk too — otherwise
      // the Thread is born with the generic "Subagent" title.
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_agent',
          input: {
            description: 'Find git remote url lobe-chat',
            prompt: 'locate the remote',
            subagent_type: 'Explore',
          },
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      // First subagent event is a reasoning block — no tool call yet.
      const first = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_agent', { thinking: 'Let me look…', type: 'thinking' }),
      );
      const reasoningChunk = first.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
      );
      expect(reasoningChunk!.data.subagent.spawnMetadata).toEqual({
        description: 'Find git remote url lobe-chat',
        prompt: 'locate the remote',
        subagentType: 'Explore',
      });

      // The later tool event for the same parent must NOT re-announce.
      const second = adapter.adapt(
        subAgent('msg_sub_2', 'toolu_agent', {
          id: 'toolu_child',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );
      const toolChunk = second.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(toolChunk!.data.subagent.spawnMetadata).toBeUndefined();
    });

    it('does NOT burn the one-shot on a first event that emits no chunk', () => {
      // The very first subagent event can carry nothing the reducer consumes —
      // an empty text/thinking block or a usage-only `content: []`. That event
      // never reaches `ensureRun` (no chunk), so it must NOT mark the parent
      // announced; the metadata has to survive for the next REAL chunk, which is
      // the one that actually lazy-creates + titles the Thread.
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_agent',
          input: {
            description: 'Find git remote url lobe-chat',
            prompt: 'locate the remote',
            subagent_type: 'Explore',
          },
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      // First subagent event: empty content + an empty text block — emits nothing.
      const first = adapter.adapt({
        message: { content: [{ text: '', type: 'text' }], id: 'msg_sub_0', usage: {} },
        parent_tool_use_id: 'toolu_agent',
        type: 'assistant',
      });
      expect(first.some((e) => e.type === 'stream_chunk')).toBe(false);

      // Second event is the first REAL chunk — it must still carry spawnMetadata.
      const second = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_agent', { thinking: 'Let me look…', type: 'thinking' }),
      );
      const reasoningChunk = second.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'reasoning',
      );
      expect(reasoningChunk!.data.subagent.spawnMetadata).toEqual({
        description: 'Find git remote url lobe-chat',
        prompt: 'locate the remote',
        subagentType: 'Explore',
      });
    });

    it('extracts spawnMetadata from the `Agent` spawn-tool variant too (not just Task)', () => {
      // Real CC traces emit `Agent` for general-purpose subagents, not just
      // `Task` — the adapter should cache input for ANY main-agent tool and
      // build spawnMetadata off whichever spawn-tool variant was used.
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_agent',
          input: {
            description: 'lookup the pwd',
            prompt: 'run pwd and report it back',
            subagent_type: 'general-purpose',
          },
          name: 'Agent',
          type: 'tool_use',
        }),
      );

      const first = adapter.adapt(
        subAgent('msg_sub_1', 'toolu_agent', {
          id: 'toolu_child',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );
      const firstChunk = first.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(firstChunk!.data.subagent.spawnMetadata).toEqual({
        description: 'lookup the pwd',
        prompt: 'run pwd and report it back',
        subagentType: 'general-purpose',
      });
    });

    it('does NOT stamp subagent context on non-subagent (main-agent) tool_uses', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);

      const events = adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_read',
          input: { file_path: '/a.ts' },
          name: 'Read',
          type: 'tool_use',
        }),
      );

      const toolsChunk = events.find(
        (e) => e.type === 'stream_chunk' && e.data.chunkType === 'tools_calling',
      );
      expect(toolsChunk!.data.subagent).toBeUndefined();
    });

    it('stamps subagent context on tool_result for subagent inner tools', () => {
      const adapter = new ClaudeCodeAdapter();
      adapter.adapt(init);
      adapter.adapt(
        mainAssistant('msg_main', {
          id: 'toolu_task',
          input: { description: 'x' },
          name: 'Task',
          type: 'tool_use',
        }),
      );
      adapter.adapt(
        subAgent('msg_sub', 'toolu_task', {
          id: 'toolu_child',
          input: {},
          name: 'Bash',
          type: 'tool_use',
        }),
      );

      // Subagent's tool_result arrives in a `user` event with parent_tool_use_id.
      const events = adapter.adapt({
        message: {
          content: [{ content: 'ok', tool_use_id: 'toolu_child', type: 'tool_result' }],
        },
        parent_tool_use_id: 'toolu_task',
        type: 'user',
      });

      const result = events.find((e) => e.type === 'tool_result');
      expect(result!.data.subagent).toEqual({ parentToolCallId: 'toolu_task' });
      const end = events.find((e) => e.type === 'tool_end');
      expect(end!.data.subagent).toEqual({ parentToolCallId: 'toolu_task' });
    });
  });

  // ────────────────────────────────────────────────────
  // external signal detection (Monitor task callbacks)
  // ────────────────────────────────────────────────────
  describe('external signal detection ()', () => {
    const init = (adapter: ClaudeCodeAdapter) => {
      adapter.adapt({
        model: 'claude-sonnet-4-6',
        session_id: 'sess_1',
        subtype: 'init',
        type: 'system',
      });
    };

    const ccUser = (toolCallId: string, content: string) => ({
      message: {
        content: [{ content, tool_use_id: toolCallId, type: 'tool_result' }],
      },
      type: 'user',
    });
    const ccMessageStart = (msgId: string) => ({
      event: { message: { id: msgId, model: 'claude-sonnet-4-6' }, type: 'message_start' },
      type: 'stream_event',
    });
    const ccTaskStarted = (taskId: string, toolUseId: string) => ({
      session_id: 'sess_1',
      subtype: 'task_started',
      task_id: taskId,
      tool_use_id: toolUseId,
      type: 'system',
    });
    const ccTaskNotification = (taskId: string) => ({
      session_id: 'sess_1',
      subtype: 'task_notification',
      task_id: taskId,
      type: 'system',
    });

    /**
     * Real-world Monitor flow recorded from `claude -p` against the
     * Monitor skill:
     *   1. LLM emits Monitor tool_use → adapter notes the name
     *   2. CC emits `system task_started` (Monitor registers as a task)
     *   3. user event with tool_result (initial "Monitor started" ack)
     *   4. Assistant turn opens, LLM writes confirmation toolless reply
     *   5. RESULT — turn ends, no new user input arrives
     *   6. SYSTEM init + assistant message_start — Monitor's stdout
     *      pushed and CC re-invoked the LLM. THIS turn is a signal callback.
     */
    it('attaches externalSignal when a new turn opens without user input while a task is active', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Step 0: Monitor tool_use
      adapter.adapt({
        message: {
          content: [
            { id: 'toolu_mon', input: { shell: 'every 1s' }, name: 'Monitor', type: 'tool_use' },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });

      // CC registers the long-running task
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));

      // Initial tool_result (LLM's natural follow-up turn — NOT a signal callback)
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));

      // Step 1: natural confirmation turn — opens AFTER the user event,
      // so it consumes `hasUnhandledUserInput` and is NOT signal-tagged.
      const confirm = adapter.adapt(ccMessageStart('msg_02'));
      const confirmStart = confirm.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(confirmStart!.data.externalSignal).toBeUndefined();

      // Step 2: Monitor pushed an event → CC re-invokes the LLM without
      // any new user message. A signal callback.
      const cb1 = adapter.adapt(ccMessageStart('msg_03'));
      const cb1Start = cb1.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(cb1Start!.data.externalSignal).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });
    });

    // Regression (P2): on the BATCH path, when the post-tool confirmation REUSES
    // the Monitor tool's message.id, the forced split must still consume
    // `hasUnhandledUserInput` (armed by the tool_result). Otherwise the stale
    // flag survives and the next callback turn — opened while the task is active
    // with no new user input — fails the `!hasUnhandledUserInput` signal check,
    // leaving the first stdout callback untagged.
    it('still tags the next callback after a forced post-tool split reuses the tool id (batch Monitor flow)', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Monitor tool_use under msg_01 (batch: an `assistant` event, not a delta).
      adapter.adapt({
        message: {
          content: [
            { id: 'toolu_mon', input: { shell: 'every 1s' }, name: 'Monitor', type: 'tool_use' },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      // tool_result → arms hasUnhandledUserInput.
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));

      // Confirmation turn REUSES msg_01 → forced post-tool split. It is the
      // natural follow-up to the tool_result, so it carries no signal AND must
      // consume hasUnhandledUserInput.
      const confirm = adapter.adapt({
        message: {
          id: 'msg_01',
          content: [{ text: 'mock monitoring confirmation', type: 'text' }],
        },
        type: 'assistant',
      });
      const confirmStart = confirm.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(confirmStart).toBeDefined();
      expect(confirmStart!.data.externalSignal).toBeUndefined();

      // Monitor pushes an event → CC re-invokes with a NEW id and no new user
      // input. This callback must be signal-tagged — only true once the forced
      // split cleared the stale flag.
      const cb1 = adapter.adapt({
        message: { id: 'msg_02', content: [{ text: 'mock callback turn', type: 'text' }] },
        type: 'assistant',
      });
      const cb1Start = cb1.find((e) => e.type === 'stream_start' && e.data?.newStep);
      expect(cb1Start!.data.externalSignal).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });
    });

    it('keeps tagging consecutive signal callbacks with incrementing sequence', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation turn (no signal)

      const sequences: (number | undefined)[] = [];
      for (let i = 3; i <= 5; i++) {
        const ev = adapter.adapt(ccMessageStart(`msg_0${i}`));
        const start = ev.find((e) => e.type === 'stream_start' && e.data?.newStep);
        sequences.push(start!.data.externalSignal?.sequence);
      }
      expect(sequences).toEqual([1, 2, 3]);
    });

    it('tags the post-task summary turn with `task-completion` after `task_notification`', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation (no signal)

      // One signal callback while task is alive
      const cb1 = adapter.adapt(ccMessageStart('msg_03'));
      expect(
        cb1.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sequence: 1,
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'tool-stdout',
      });

      // Task ends
      adapter.adapt(ccTaskNotification('task_1'));

      // Next turn — task ended, but the post-task summary keeps the
      // source-tool lineage so MessageCollector can render it inside
      // the same AssistantGroup as the preceding callbacks.
      const after = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        after.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toEqual({
        sourceToolCallId: 'toolu_mon',
        sourceToolName: 'Monitor',
        type: 'task-completion',
      });

      // The completion tag is one-shot — a subsequent turn (e.g. if CC
      // spawned another LLM call) must not inherit it.
      const followUp = adapter.adapt(ccMessageStart('msg_05'));
      expect(
        followUp.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    /**
     * Real-world regression (recorded on tpc_joZS2mksoY5L): a slow `git commit`
     * (running a lint-staged hook) makes CC track the Bash call as a task and
     * emit `task_started` + `task_notification` back-to-back, with NO out-of-band
     * callback turn in between, immediately followed by the tool_result. That is
     * an inline synchronous tool, not a Monitor-style long-running task — the next
     * turn is the normal main-chain continuation and must NOT be tagged
     * `task-completion` (doing so mis-anchors it and drops it from the rendered
     * chain).
     */
    it('does NOT tag the next turn when a task started and ended with no callbacks (inline tool)', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // A Bash `git commit` tool_use.
      adapter.adapt({
        message: {
          content: [
            {
              id: 'toolu_commit',
              input: { command: 'git commit' },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          id: 'msg_01',
        },
        type: 'assistant',
      });

      // CC tracks the slow commit as a task, then notifies completion
      // back-to-back — NO callback turn opened while it was alive.
      adapter.adapt(ccTaskStarted('task_1', 'toolu_commit'));
      adapter.adapt(ccTaskNotification('task_1'));

      // The commit's tool_result is consumed inline by the next turn.
      adapter.adapt(ccUser('toolu_commit', 'committed'));

      // Next turn is plain continuation — must carry NO externalSignal.
      const next = adapter.adapt(ccMessageStart('msg_02'));
      expect(
        next.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('clears unconsumed task-completion lineage on `result`', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02'));
      // A signal callback fires while the task is alive (callbackCount > 0), so
      // `task_notification` genuinely arms pendingTaskCompletion — otherwise (an
      // inline tool with no callbacks) nothing is armed and this test would pass
      // vacuously, no longer guarding the `result` clear path.
      adapter.adapt(ccMessageStart('msg_03'));
      adapter.adapt(ccTaskNotification('task_1'));
      // Run ends before the summary turn fires (unusual but possible).
      adapter.adapt({ result: 'ok', type: 'result', usage: undefined });

      // A later turn (e.g. follow-up user message) must NOT inherit
      // the unconsumed task-completion lineage — `result` dropped it.
      const next = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        next.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('does NOT tag turns that follow a user/tool_result event', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation (no signal)

      // LLM emits Bash mid-task → Bash's tool_result arrives → next turn
      // is a natural follow-up to Bash, NOT a Monitor callback.
      adapter.adapt({
        message: {
          content: [{ id: 'toolu_bash', input: {}, name: 'Bash', type: 'tool_use' }],
          id: 'msg_03',
        },
        type: 'assistant',
      });
      adapter.adapt(ccUser('toolu_bash', 'bash ok'));

      const ev = adapter.adapt(ccMessageStart('msg_04'));
      expect(
        ev.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeUndefined();
    });

    it('does NOT trigger from subagent inner user events', () => {
      const adapter = new ClaudeCodeAdapter();
      init(adapter);

      // Main agent fires Monitor, then registers task
      adapter.adapt({
        message: {
          content: [{ id: 'toolu_mon', input: {}, name: 'Monitor', type: 'tool_use' }],
          id: 'msg_01',
        },
        type: 'assistant',
      });
      adapter.adapt(ccTaskStarted('task_1', 'toolu_mon'));
      adapter.adapt(ccUser('toolu_mon', 'Monitor started'));
      adapter.adapt(ccMessageStart('msg_02')); // confirmation (no signal)

      // Subagent inner tool_result fires WITH parent_tool_use_id — must
      // NOT reset hasUnhandledUserInput; the next main-chain turn is
      // still a signal callback.
      adapter.adapt({
        message: {
          content: [{ content: 'inner', tool_use_id: 'toolu_inner', type: 'tool_result' }],
        },
        parent_tool_use_id: 'toolu_other',
        type: 'user',
      });

      const ev = adapter.adapt(ccMessageStart('msg_03'));
      expect(
        ev.find((e) => e.type === 'stream_start' && e.data?.newStep)!.data.externalSignal,
      ).toBeDefined();
    });
  });
});
