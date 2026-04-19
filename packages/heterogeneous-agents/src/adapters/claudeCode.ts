/**
 * Claude Code Adapter
 *
 * Converts Claude Code CLI `--output-format stream-json --verbose` (ndjson)
 * events into unified HeterogeneousAgentEvent[] that the executor feeds into
 * LobeHub's Gateway event handler.
 *
 * Stream-json event shapes (from real CLI output):
 *
 *   {type: 'system', subtype: 'init', session_id, model, ...}
 *   {type: 'assistant', message: {id, content: [{type: 'thinking', thinking}], ...}}
 *   {type: 'assistant', message: {id, content: [{type: 'tool_use', id, name, input}], ...}}
 *   {type: 'user', message: {content: [{type: 'tool_result', tool_use_id, content}]}}
 *   {type: 'assistant', message: {id: <NEW>, content: [{type: 'text', text}], ...}}
 *   {type: 'result', is_error, result, ...}
 *   {type: 'rate_limit_event', ...}  (ignored)
 *
 * With `--include-partial-messages` (enabled by default in this adapter), CC
 * also emits token-level deltas wrapped as:
 *
 *   {type: 'stream_event', event: {type: 'message_start', message: {id, model, ...}}}
 *   {type: 'stream_event', event: {type: 'content_block_delta', index, delta: {type: 'text_delta', text}}}
 *   {type: 'stream_event', event: {type: 'content_block_delta', index, delta: {type: 'thinking_delta', thinking}}}
 *
 * Deltas arrive BEFORE the matching `assistant` event that carries the full
 * content block. We stream the deltas out as incremental chunks and suppress
 * the duplicate emission from `handleAssistant` for any message.id that has
 * already been streamed.
 *
 * Key characteristics:
 * - Each content block (thinking / tool_use / text) streams in its OWN assistant event
 * - Multiple events can share the same `message.id` — these are ONE LLM turn
 * - When `message.id` changes, a new LLM turn has begun — new DB assistant message
 * - `tool_result` blocks are in `type: 'user'` events, not assistant events
 */

import {
  ClaudeCodeApiName,
  type ClaudeCodeTodoItem,
  type TodoWriteArgs,
} from '@lobechat/builtin-tool-claude-code';

import type {
  AgentCLIPreset,
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StreamChunkData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

/**
 * CC's TodoWrite is a declarative state-write tool: its `tool_use.input` IS
 * the target todos list, and the `tool_result` content is just a confirmation
 * string. Translating the input into the shared `StepContextTodos` shape lets
 * the Gateway/ACP-aligned `pluginState.todos` contract light up the
 * TodoProgress card without any CC-specific knowledge leaking into selectors
 * or executors.
 *
 * Word mapping: CC `pending|in_progress|completed` → shared `todo|processing|completed`.
 * Text field: use `activeForm` while in progress (present-continuous is what
 * the header surfaces), fall back to `content` for every other state.
 */
const synthesizeTodoWritePluginState = (
  args: TodoWriteArgs,
): {
  todos: {
    items: Array<{ status: 'todo' | 'processing' | 'completed'; text: string }>;
    updatedAt: string;
  };
} => {
  const items = (args.todos || []).map((todo: ClaudeCodeTodoItem) => {
    const status =
      todo.status === 'in_progress'
        ? 'processing'
        : todo.status === 'pending'
          ? 'todo'
          : 'completed';
    const text = todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content;
    return { status, text } as const;
  });
  return { todos: { items, updatedAt: new Date().toISOString() } };
};

/**
 * Convert a raw Anthropic-shape usage object (per-turn or grand-total from
 * Claude Code's `result` event) into the provider-agnostic `UsageData` shape.
 * Returns undefined when no tokens were consumed, so callers can skip empty
 * events without a null-check cascade.
 */
const toUsageData = (
  raw:
    | {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | null
    | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;
  const inputCacheMissTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cache_read_input_tokens || 0;
  const inputWriteCacheTokens = raw.cache_creation_input_tokens || 0;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  return {
    inputCacheMissTokens,
    inputCachedTokens: inputCachedTokens || undefined,
    inputWriteCacheTokens: inputWriteCacheTokens || undefined,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

// ─── CLI Preset ───

export const claudeCodePreset: AgentCLIPreset = {
  baseArgs: [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
  ],
  promptMode: 'stdin',
  resumeArgs: (sessionId) => ['--resume', sessionId],
};

// ─── Adapter ───

export class ClaudeCodeAdapter implements AgentEventAdapter {
  sessionId?: string;

  /** Pending tool_use ids awaiting their tool_result */
  private pendingToolCalls = new Set<string>();
  private started = false;
  private stepIndex = 0;
  /** Track current message.id to detect step boundaries */
  private currentMessageId: string | undefined;
  /** message.id of the stream_event delta flow currently in flight */
  private currentStreamEventMessageId: string | undefined;
  /**
   * Latest model seen for the in-flight message.id — captured from
   * `message_start` (partial mode) or `assistant` events, emitted alongside
   * authoritative usage on `message_delta`.
   */
  private currentStreamEventModel: string | undefined;
  /** message.ids whose text has already been streamed as deltas — skip the full-block emission */
  private messagesWithStreamedText = new Set<string>();
  /** message.ids whose thinking has already been streamed as deltas — skip the full-block emission */
  private messagesWithStreamedThinking = new Set<string>();
  /**
   * Cumulative tool_use blocks per message.id. CC streams each tool_use in
   * its OWN assistant event, and the handler's in-memory assistant.tools
   * update uses a REPLACING array merge — so chunks must carry every tool
   * seen on this turn, not just the latest, or prior tools render as orphans
   * until the next `fetchAndReplaceMessages`.
   */
  private toolCallsByMessageId = new Map<string, ToolCallPayload[]>();
  /**
   * Cached TodoWrite inputs keyed by tool_use.id. Populated in `handleAssistant`
   * when a TodoWrite tool_use block arrives and drained in `handleUser` at
   * tool_result time so the synthesized pluginState can travel with the result
   * event. Entries are deleted immediately after emit to keep long sessions
   * bounded.
   */
  private todoWriteInputs = new Map<string, TodoWriteArgs>();

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];

    switch (raw.type) {
      case 'system': {
        return this.handleSystem(raw);
      }
      case 'assistant': {
        return this.handleAssistant(raw);
      }
      case 'user': {
        return this.handleUser(raw);
      }
      case 'stream_event': {
        return this.handleStreamEvent(raw);
      }
      case 'result': {
        return this.handleResult(raw);
      }
      default: {
        return [];
      } // rate_limit_event, etc.
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    // Close any still-open tools (shouldn't happen in normal flow, but be safe)
    const events = [...this.pendingToolCalls].map((id) =>
      this.makeEvent('tool_end', { isSuccess: true, toolCallId: id }),
    );
    this.pendingToolCalls.clear();
    return events;
  }

  // ─── Private handlers ───

  private handleSystem(raw: any): HeterogeneousAgentEvent[] {
    if (raw.subtype !== 'init') return [];
    this.sessionId = raw.session_id;
    this.started = true;
    return [
      this.makeEvent('stream_start', {
        model: raw.model,
        provider: 'claude-code',
      }),
    ];
  }

  private handleAssistant(raw: any): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const events: HeterogeneousAgentEvent[] = [];
    const messageId = raw.message?.id;

    events.push(...this.openMainMessage(messageId, raw.message?.model));

    // Track the latest model — emitted alongside authoritative usage on the
    // matching `message_delta`. We deliberately do NOT emit turn_metadata
    // here: under `--include-partial-messages` (our default), every
    // content-block `assistant` event echoes a STALE usage snapshot from
    // `message_start` (e.g. `output_tokens: 8`); the per-turn total only
    // arrives on `stream_event: message_delta`.
    if (raw.message?.model) this.currentStreamEventModel = raw.message.model;

    // Each content array here is usually ONE block (thinking OR tool_use OR text)
    // but we handle multiple defensively.
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const newToolCalls: ToolCallPayload[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text': {
          if (block.text) textParts.push(block.text);
          break;
        }
        case 'thinking': {
          if (block.thinking) reasoningParts.push(block.thinking);
          break;
        }
        case 'tool_use': {
          const toolPayload: ToolCallPayload = {
            apiName: block.name,
            arguments: JSON.stringify(block.input || {}),
            id: block.id,
            identifier: 'claude-code',
            type: 'default',
          };
          newToolCalls.push(toolPayload);
          this.pendingToolCalls.add(block.id);
          if (block.name === ClaudeCodeApiName.TodoWrite && block.input) {
            this.todoWriteInputs.set(block.id, block.input as TodoWriteArgs);
          }
          break;
        }
      }
    }

    // Skip full-block emission when deltas have already been streamed for
    // this message.id (partial-messages mode). Otherwise the UI would see
    // the text/thinking twice — once as deltas, once as a giant trailing chunk.
    const textAlreadyStreamed = !!messageId && this.messagesWithStreamedText.has(messageId);
    const thinkingAlreadyStreamed = !!messageId && this.messagesWithStreamedThinking.has(messageId);
    if (textParts.length > 0 && !textAlreadyStreamed) {
      events.push(this.makeChunkEvent({ chunkType: 'text', content: textParts.join('') }));
    }
    if (reasoningParts.length > 0 && !thinkingAlreadyStreamed) {
      events.push(
        this.makeChunkEvent({ chunkType: 'reasoning', reasoning: reasoningParts.join('') }),
      );
    }
    if (newToolCalls.length > 0) {
      const msgKey = messageId ?? '';
      const existing = this.toolCallsByMessageId.get(msgKey) ?? [];
      const existingIds = new Set(existing.map((t) => t.id));
      const freshTools = newToolCalls.filter((t) => !existingIds.has(t.id));
      const cumulative = [...existing, ...freshTools];
      this.toolCallsByMessageId.set(msgKey, cumulative);

      events.push(this.makeChunkEvent({ chunkType: 'tools_calling', toolsCalling: cumulative }));
      // tool_start fires only for newly-seen ids so an echoed tool_use does
      // not re-open a closed lifecycle.
      for (const t of freshTools) {
        events.push(this.makeEvent('tool_start', { toolCalling: t }));
      }
    }

    return events;
  }

  /**
   * Handle user events — these contain tool_result blocks.
   * NOTE: In Claude Code, tool results are emitted as `type: 'user'` events
   * (representing the synthetic user turn that feeds results back to the LLM).
   */
  private handleUser(raw: any): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const events: HeterogeneousAgentEvent[] = [];

    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const toolCallId: string | undefined = block.tool_use_id;
      if (!toolCallId) continue;

      const resultContent =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .map((c: any) => c.text || c.content || '')
                .filter(Boolean)
                .join('\n')
            : JSON.stringify(block.content || '');

      // Synthesize pluginState for tools whose input IS the target state.
      // TodoWrite is currently the only such tool; future CC tools (Task,
      // Skill activation, …) extend this same collection point.
      //
      // Guard on `is_error`: a failed TodoWrite means the snapshot was never
      // applied on CC's side, so we must not persist it here either. Since
      // `selectTodosFromMessages` picks the latest `pluginState.todos` from
      // any producer, leaking a failed write would overwrite the live todo
      // UI with changes that never actually happened. Drain the cache either
      // way so a retry with a fresh tool_use id doesn't inherit stale args.
      const cachedTodoArgs = this.todoWriteInputs.get(toolCallId);
      if (cachedTodoArgs) this.todoWriteInputs.delete(toolCallId);
      const pluginState =
        cachedTodoArgs && !block.is_error
          ? synthesizeTodoWritePluginState(cachedTodoArgs)
          : undefined;

      // Emit tool_result for executor to persist content to tool message
      events.push(
        this.makeEvent('tool_result', {
          content: resultContent,
          isError: !!block.is_error,
          pluginState,
          toolCallId,
        } satisfies ToolResultData),
      );

      // Then emit tool_end (signals handler to refresh tool result UI)
      if (this.pendingToolCalls.has(toolCallId)) {
        this.pendingToolCalls.delete(toolCallId);
        events.push(this.makeEvent('tool_end', { isSuccess: !block.is_error, toolCallId }));
      }
    }

    return events;
  }

  private handleResult(raw: any): HeterogeneousAgentEvent[] {
    // Emit authoritative grand-total usage from CC's result event. The
    // executor currently ignores this phase (it persists per-turn via
    // turn_metadata), but we still emit it so other consumers — cost
    // displays, logs — can read the normalized total.
    const events: HeterogeneousAgentEvent[] = [];
    const usage = toUsageData(raw.usage);
    if (usage) {
      events.push(
        this.makeEvent('step_complete', {
          costUsd: raw.total_cost_usd,
          phase: 'result_usage',
          usage,
        }),
      );
    }

    const finalEvent: HeterogeneousAgentEvent = raw.is_error
      ? this.makeEvent('error', {
          error: raw.result || 'Agent execution failed',
          message: raw.result || 'Agent execution failed',
        })
      : this.makeEvent('agent_runtime_end', {});

    return [...events, this.makeEvent('stream_end', {}), finalEvent];
  }

  /**
   * Handle stream_event wrapper emitted under `--include-partial-messages`.
   * Surfaces text_delta / thinking_delta as incremental stream_chunk events
   * and keeps message-boundary state (stepIndex / currentMessageId) in sync
   * so subsequent assistant events don't re-open an already-known message.
   *
   * Tool-input (input_json_delta) deltas are ignored; tool_use is emitted as
   * a complete block via the `assistant` event to avoid half-parsed JSON in
   * the UI.
   */
  private handleStreamEvent(raw: any): HeterogeneousAgentEvent[] {
    const event = raw?.event;
    if (!event) return [];

    switch (event.type) {
      case 'message_start': {
        const msgId: string | undefined = event.message?.id;
        this.currentStreamEventMessageId = msgId;
        if (event.message?.model) this.currentStreamEventModel = event.message.model;
        return this.openMainMessage(msgId, event.message?.model);
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta) return [];
        const msgId = this.currentStreamEventMessageId;
        if (delta.type === 'text_delta' && delta.text) {
          if (msgId) this.messagesWithStreamedText.add(msgId);
          return [this.makeChunkEvent({ chunkType: 'text', content: delta.text })];
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
          if (msgId) this.messagesWithStreamedThinking.add(msgId);
          return [this.makeChunkEvent({ chunkType: 'reasoning', reasoning: delta.thinking })];
        }
        return [];
      }
      case 'message_delta': {
        // Authoritative per-turn usage. CC echoes stale message_start usage on
        // every `assistant` event, so `handleAssistant` deliberately skips the
        // emission and lets this branch own it. `message_delta.usage` carries
        // the full final usage (input + cache + final output_tokens).
        const usage = toUsageData(event.usage);
        if (!usage) return [];
        return [
          this.makeEvent('step_complete', {
            model: this.currentStreamEventModel,
            phase: 'turn_metadata',
            provider: 'claude-code',
            usage,
          }),
        ];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Idempotent message-boundary opener called by both `handleAssistant` and
   * `handleStreamEvent(message_start)`. Ensures `stepIndex` advances and
   * `stream_end` / `stream_start(newStep)` fire on the FIRST signal of a new
   * message.id — whether that signal is a delta event or the complete
   * assistant event.
   *
   * - If `started === false`: auto-start (emit stream_start, record id).
   * - If `messageId === currentMessageId`: no-op.
   * - If this is the first message after a system-init stream_start: just
   *   record the id (init already primed the executor).
   * - Otherwise: advance stepIndex and emit stream_end + stream_start(newStep).
   */
  private openMainMessage(
    messageId: string | undefined,
    model: string | undefined,
  ): HeterogeneousAgentEvent[] {
    if (!messageId) return [];

    if (!this.started) {
      this.started = true;
      this.currentMessageId = messageId;
      return [this.makeEvent('stream_start', { model, provider: 'claude-code' })];
    }

    if (messageId === this.currentMessageId) return [];

    if (this.currentMessageId === undefined) {
      // First assistant/delta after system init — record without step boundary.
      this.currentMessageId = messageId;
      return [];
    }

    this.currentMessageId = messageId;
    this.stepIndex++;
    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', { model, newStep: true, provider: 'claude-code' }),
    ];
  }

  // ─── Event factories ───

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }

  private makeChunkEvent(data: StreamChunkData): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type: 'stream_chunk' };
  }
}
