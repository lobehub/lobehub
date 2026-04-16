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
 * Key characteristics:
 * - Each content block (thinking / tool_use / text) streams in its OWN assistant event
 * - Multiple events can share the same `message.id` — these are ONE LLM turn
 * - When `message.id` changes, a new LLM turn has begun — new DB assistant message
 * - `tool_result` blocks are in `type: 'user'` events, not assistant events
 */

import type {
  AgentCLIPreset,
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StreamChunkData,
  ToolCallPayload,
  ToolResultData,
} from '../types';

// ─── CLI Preset ───

export const claudeCodePreset: AgentCLIPreset = {
  baseArgs: [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
  ],
  promptMode: 'positional',
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
  /** Track which message.id has already emitted usage (dedup) */
  private usageEmittedForMessageId: string | undefined;

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

    if (!this.started) {
      this.started = true;
      this.currentMessageId = messageId;
      events.push(
        this.makeEvent('stream_start', {
          model: raw.message?.model,
          provider: 'claude-code',
        }),
      );
    } else if (messageId && messageId !== this.currentMessageId) {
      if (this.currentMessageId === undefined) {
        // First assistant message after init — just record the ID, no step boundary.
        // The init stream_start already primed the executor with the pre-created
        // assistant message, so we don't need a new one.
        this.currentMessageId = messageId;
      } else {
        // New message.id = new LLM turn. Emit stream_end for previous step,
        // then stream_start for the new one so executor creates a new assistant message.
        this.currentMessageId = messageId;
        this.stepIndex++;
        events.push(this.makeEvent('stream_end', {}));
        events.push(
          this.makeEvent('stream_start', {
            model: raw.message?.model,
            newStep: true,
            provider: 'claude-code',
          }),
        );
      }
    }

    // Per-turn model + usage snapshot — emitted as 'step_complete'-like
    // metadata event so executor can track latest model and accumulated usage.
    // DEDUP: same message.id carries identical usage on every content block
    // (thinking, text, tool_use). Only emit once per message.id.
    if ((raw.message?.model || raw.message?.usage) && messageId !== this.usageEmittedForMessageId) {
      this.usageEmittedForMessageId = messageId;
      events.push(
        this.makeEvent('step_complete', {
          model: raw.message?.model,
          phase: 'turn_metadata',
          usage: raw.message?.usage,
        }),
      );
    }

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
          break;
        }
      }
    }

    if (textParts.length > 0) {
      events.push(this.makeChunkEvent({ chunkType: 'text', content: textParts.join('') }));
    }
    if (reasoningParts.length > 0) {
      events.push(
        this.makeChunkEvent({ chunkType: 'reasoning', reasoning: reasoningParts.join('') }),
      );
    }
    if (newToolCalls.length > 0) {
      events.push(this.makeChunkEvent({ chunkType: 'tools_calling', toolsCalling: newToolCalls }));
      // Also emit tool_start for each — the handler's tool_start is a no-op
      // but it's semantically correct for the lifecycle.
      for (const t of newToolCalls) {
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

      // Emit tool_result for executor to persist content to tool message
      events.push(
        this.makeEvent('tool_result', {
          content: resultContent,
          isError: !!block.is_error,
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
    // Emit authoritative usage from result event (overrides per-turn accumulation)
    const events: HeterogeneousAgentEvent[] = [];
    if (raw.usage) {
      events.push(
        this.makeEvent('step_complete', {
          costUsd: raw.total_cost_usd,
          phase: 'result_usage',
          usage: raw.usage,
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

  // ─── Event factories ───

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }

  private makeChunkEvent(data: StreamChunkData): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type: 'stream_chunk' };
  }
}
