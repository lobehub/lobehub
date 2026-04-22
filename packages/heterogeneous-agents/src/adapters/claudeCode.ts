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
  SubagentEventContext,
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
  /**
   * Cached inputs for main-agent tool_uses keyed by their tool_use.id.
   * Populated for every main-agent tool_use (not just `Task`) because
   * CC uses multiple tool names for subagent delegation — real traces
   * emit `Agent` for general-purpose subagents while the spec documents
   * `Task`. Keying on "any main-agent tool" and looking up by
   * `parent_tool_use_id` on the FIRST subagent event lets us extract
   * `description` / `prompt` / `subagent_type` regardless of which
   * spawn-tool variant the model used. Kept adapter-internal — the
   * executor never reads this map; it only sees the normalized
   * `SubagentSpawnMetadata`.
   */
  private mainToolInputsById = new Map<string, Record<string, any>>();
  /**
   * Set of parent tool_use ids whose spawn metadata has already been
   * announced on a subagent event. Guarantees `spawnMetadata` appears
   * exactly once per subagent run — on the first subagent chunk for that
   * parent — so the executor's lazy-create logic isn't tempted to
   * recreate the Thread on every chunk.
   */
  private announcedSpawns = new Set<string>();

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

    // CC tags subagent events (Agent / Task tool spawned flows) with
    // `parent_tool_use_id` pointing back at the outer tool_use. These are a
    // side-channel of the main agent's stream — they must not advance the
    // main step tracker, emit text into the main bubble, or double-count
    // usage. Route them through a dedicated handler so the main-agent flow
    // below stays free of subagent special cases.
    const parentToolUseId: string | undefined = raw.parent_tool_use_id;
    if (parentToolUseId) return this.handleSubagentAssistant(raw, parentToolUseId);

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
          newToolCalls.push({
            apiName: block.name,
            arguments: JSON.stringify(block.input || {}),
            id: block.id,
            identifier: 'claude-code',
            type: 'default',
          });
          this.pendingToolCalls.add(block.id);
          // Cache EVERY main-agent tool_use input so the subagent-spawn
          // handler (`emitToolChunk`) can look up the parent's args on
          // first subagent event regardless of which spawn-tool name CC
          // used (`Task`, `Agent`, etc.). Non-spawn tools occupy a tiny
          // amount of memory and get pruned naturally when the run ends.
          if (block.input) this.mainToolInputsById.set(block.id, block.input);
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
    events.push(...this.emitToolChunk(newToolCalls, messageId));

    return events;
  }

  /**
   * Handle a subagent assistant event (tagged with `parent_tool_use_id`).
   *
   * Subagent events are a side-channel of the main agent's stream and have
   * two hard constraints:
   *  - no main-agent step boundary (each subagent turn introduces a new
   *    `message.id`; flushing that as a newStep would orphan main-agent
   *    bubbles)
   *  - no model / usage tracking on the main agent (CC's `result` event
   *    carries the authoritative grand total; re-summing per-turn deltas
   *    here would double-count against the main agent)
   *
   * Text / reasoning from subagent events ARE emitted — as `stream_chunk`
   * events tagged with the `subagent` peer field — so the executor can
   * accumulate them into the in-thread assistant's content, giving the
   * Thread view a readable subagent conversation (user → assistant text
   * → tools → assistant text → ...). Without this the thread only ever
   * shows tool calls with no closing reasoning / summary.
   *
   * Subagent lineage lives as event-level **peer fields** on each chunk
   * (`subagent.parentToolCallId` + `subagent.subagentMessageId`), not on
   * individual `ToolCallPayload` items — tool payloads stay minimal and
   * persistence-safe.
   */
  private handleSubagentAssistant(raw: any, parentToolUseId: string): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const messageId: string | undefined = raw.message?.id;
    const subagentCtx = {
      parentToolCallId: parentToolUseId,
      subagentMessageId: messageId ?? '',
    };

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
          newToolCalls.push({
            apiName: block.name,
            arguments: JSON.stringify(block.input || {}),
            id: block.id,
            identifier: 'claude-code',
            type: 'default',
          });
          this.pendingToolCalls.add(block.id);
          if (block.name === ClaudeCodeApiName.TodoWrite && block.input) {
            this.todoWriteInputs.set(block.id, block.input as TodoWriteArgs);
          }
          break;
        }
      }
    }

    const events: HeterogeneousAgentEvent[] = [];

    // Subagent text / reasoning chunks — NOT deduped against
    // `messagesWithStreamedText` (unlike the main-agent path) because
    // subagent events don't arrive via `stream_event` partial-messages
    // deltas; the full block IS the only emission.
    if (textParts.length > 0) {
      events.push(
        this.makeChunkEvent({
          chunkType: 'text',
          content: textParts.join(''),
          subagent: subagentCtx,
        }),
      );
    }
    if (reasoningParts.length > 0) {
      events.push(
        this.makeChunkEvent({
          chunkType: 'reasoning',
          reasoning: reasoningParts.join(''),
          subagent: subagentCtx,
        }),
      );
    }
    events.push(...this.emitToolChunk(newToolCalls, messageId, subagentCtx));
    return events;
  }

  /**
   * Accumulate new tool_use blocks for a message.id and emit the
   * `tools_calling` chunk + `tool_start` lifecycle events.
   *
   * CC streams each tool_use in its OWN assistant event and the downstream
   * handler's in-memory `assistant.tools` update uses a REPLACING array
   * merge — so the chunk must carry every tool seen on this turn, not just
   * the latest, or prior tools render as orphans until the next
   * `fetchAndReplaceMessages`. `tool_start` fires only for newly-seen ids
   * so an echoed tool_use does not re-open a closed lifecycle.
   *
   * When `subagentCtx` is provided, the chunk + each tool_start event
   * gets the context stamped as a peer field. The FIRST chunk for a new
   * parent (tracked via `announcedSpawns`) also carries `spawnMetadata`
   * built from the cached Task args, so the executor can lazy-create
   * the Thread without knowing about CC-specific argument shapes.
   */
  private emitToolChunk(
    newToolCalls: ToolCallPayload[],
    messageId: string | undefined,
    subagentCtx?: { parentToolCallId: string; subagentMessageId: string },
  ): HeterogeneousAgentEvent[] {
    if (newToolCalls.length === 0) return [];

    const msgKey = messageId ?? '';
    const existing = this.toolCallsByMessageId.get(msgKey) ?? [];
    const existingIds = new Set(existing.map((t) => t.id));
    const freshTools = newToolCalls.filter((t) => !existingIds.has(t.id));
    const cumulative = [...existing, ...freshTools];
    this.toolCallsByMessageId.set(msgKey, cumulative);

    // Build the `subagent` peer field — stamped on the chunk + each
    // tool_start. Only the first emission for a new parent carries
    // spawnMetadata; subsequent ones carry just the lineage ids.
    const subagent: SubagentEventContext | undefined = subagentCtx
      ? {
          parentToolCallId: subagentCtx.parentToolCallId,
          subagentMessageId: subagentCtx.subagentMessageId,
        }
      : undefined;
    if (subagent && !this.announcedSpawns.has(subagent.parentToolCallId)) {
      const args = this.mainToolInputsById.get(subagent.parentToolCallId);
      if (args) {
        // CC's subagent-spawn tools (Task, Agent, ...) share the same
        // input shape (`description`, `prompt`, `subagent_type`). We pull
        // the fields defensively — any unknown spawn-tool variant that
        // happens to match this shape benefits automatically.
        subagent.spawnMetadata = {
          description: typeof args.description === 'string' ? args.description : undefined,
          prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
          subagentType: typeof args.subagent_type === 'string' ? args.subagent_type : undefined,
        };
      }
      this.announcedSpawns.add(subagent.parentToolCallId);
    }

    const chunkData: StreamChunkData = {
      chunkType: 'tools_calling',
      toolsCalling: cumulative,
    };
    if (subagent) chunkData.subagent = subagent;

    const events: HeterogeneousAgentEvent[] = [this.makeChunkEvent(chunkData)];
    for (const t of freshTools) {
      const startData: Record<string, any> = { toolCalling: t };
      if (subagent) startData.subagent = subagent;
      events.push(this.makeEvent('tool_start', startData));
    }
    return events;
  }

  /**
   * Handle user events — these contain tool_result blocks.
   * NOTE: In Claude Code, tool results are emitted as `type: 'user'` events
   * (representing the synthetic user turn that feeds results back to the LLM).
   *
   * When the user event carries `parent_tool_use_id`, the tool_result is
   * for a SUBAGENT inner tool. We stamp that as the `subagent` peer field
   * on both the `tool_result` and `tool_end` events so the executor routes
   * the update to the right Thread / tool message (subagent-turn-scoped,
   * not main-agent-scoped).
   */
  private handleUser(raw: any): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const subagentCtx: SubagentEventContext | undefined = raw.parent_tool_use_id
      ? { parentToolCallId: raw.parent_tool_use_id }
      : undefined;

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
                .map((c: any) => {
                  // `ToolSearch` results ship as `{type: 'tool_reference', tool_name}`
                  // blocks — no `text` / `content` field. Without this branch the
                  // mapper returns '' for every reference, filter drops them all,
                  // and the tool message lands in DB with empty content — leaving
                  // the UI's StatusIndicator stuck on the spinner (LOBE-7369).
                  if (c?.type === 'tool_reference' && c.tool_name) return c.tool_name;
                  // `Read` on images yields `{type: 'image', source: {...}}` blocks
                  // with no text. Drop a minimal placeholder so the tool message
                  // has non-empty content (LOBE-7338); richer image echo is a
                  // follow-up that needs structured ToolResultData.
                  if (c?.type === 'image') {
                    const mediaType = c.source?.media_type || 'image';
                    return `[Image: ${mediaType}]`;
                  }
                  return c.text || c.content || '';
                })
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
          subagent: subagentCtx,
          toolCallId,
        } satisfies ToolResultData),
      );

      // Then emit tool_end (signals handler to refresh tool result UI)
      if (this.pendingToolCalls.has(toolCallId)) {
        this.pendingToolCalls.delete(toolCallId);
        events.push(
          this.makeEvent('tool_end', {
            isSuccess: !block.is_error,
            subagent: subagentCtx,
            toolCallId,
          }),
        );
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
