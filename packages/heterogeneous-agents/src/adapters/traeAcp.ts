import { isRecord } from '@lobechat/utils/object';

import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StepCompleteData,
  StreamChunkData,
  ToolCallPayload,
  ToolResultData,
  ToolStateChunkData,
  UsageData,
} from '../types';
import { AcpStreamLifecycle } from './acpCommon';

const DEFAULT_PROVIDER = 'trae';

/**
 * Parameterization for reusing this adapter across standard-ACP agents:
 * `provider` stamps stream/tool events, `eventPrefix` selects the synthetic
 * session-lifecycle payloads (`{prefix}_session` / `{prefix}_prompt_completed`
 * / `{prefix}_error`) the owning session emits.
 */
export interface AcpSessionAdapterOptions {
  eventPrefix?: string;
  provider?: string;
}

export interface TraeAcpPayload {
  [key: string]: unknown;
  content?: unknown;
  cost?: unknown;
  input?: unknown;
  kind?: unknown;
  message?: unknown;
  model?: unknown;
  name?: unknown;
  output?: unknown;
  parameters?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  sessionId?: unknown;
  sessionUpdate?: unknown;
  size?: unknown;
  status?: unknown;
  stopReason?: unknown;
  title?: unknown;
  toolCallId?: unknown;
  type?: unknown;
  usage?: unknown;
  used?: unknown;
}

interface TraeAcpToolContent {
  content?: unknown;
  newText?: unknown;
  path?: unknown;
  terminalId?: unknown;
  type?: unknown;
}

interface TraeAcpToolResultState {
  content?: unknown;
  latest?: 'content' | 'output' | 'rawOutput';
  output?: unknown;
  rawOutput?: unknown;
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return;
};

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toolContent = (content: unknown, fallback: unknown): string => {
  if (!Array.isArray(content)) return stringify(content ?? fallback);
  const result = content
    .map((value) => {
      const block = value as TraeAcpToolContent | null;
      if (block?.type === 'content') {
        const nestedContent = block.content as { text?: unknown; type?: unknown } | null;
        if (nestedContent?.type === 'text') return stringify(nestedContent.text);
        return stringify(block.content);
      }
      if (block?.type === 'diff') {
        return [block.path, block.newText].filter((value) => typeof value === 'string').join('\n');
      }
      if (block?.type === 'terminal') return `[Terminal: ${stringify(block.terminalId)}]`;
      return stringify(block);
    })
    .filter(Boolean)
    .join('\n');
  return result || stringify(fallback);
};

/**
 * Maps the standard ACP `sessionUpdate` vocabulary into the shared event
 * contract. TRAE is the default provider; other standard-ACP agents reuse it
 * via {@link AcpSessionAdapterOptions}.
 */
export class TraeAcpAdapter implements AgentEventAdapter {
  sessionId?: string;

  private readonly eventPrefix: string;
  private readonly provider: string;
  private completedTools = new Set<string>();
  protected lastCostUsd?: number;
  protected lastUsage?: UsageData;
  private model?: string;
  private pendingTools = new Set<string>();
  private snapshotSeq = new Map<string, number>();
  protected readonly stream = new AcpStreamLifecycle((stepIndex) => ({
    ...(this.model ? { model: this.model } : {}),
    ...(stepIndex > 0 ? { newStep: true } : {}),
    provider: this.provider,
    sessionId: this.sessionId,
  }));
  private terminal = false;
  private toolResultStateById = new Map<string, TraeAcpToolResultState>();

  constructor(options: AcpSessionAdapterOptions = {}) {
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.eventPrefix = options.eventPrefix ?? this.provider;
  }

  adapt(value: unknown): HeterogeneousAgentEvent[] {
    if (!value || typeof value !== 'object' || this.terminal) return [];
    const raw = value as TraeAcpPayload;
    if (raw.type === 'session_configured') {
      if (typeof raw.model === 'string') this.model = raw.model;
      return [];
    }
    if (raw.type === `${this.eventPrefix}_session`) {
      if (typeof raw.sessionId === 'string') this.sessionId = raw.sessionId;
      if (typeof raw.model === 'string') this.model = raw.model;
      return [];
    }
    if (raw.type === `${this.eventPrefix}_prompt_completed`) {
      const usage = this.toUsageData(raw.usage) ?? this.lastUsage;
      const costUsd = this.toCostUsd(raw.cost) ?? this.lastCostUsd;
      return this.complete(raw.stopReason, usage, costUsd);
    }
    if (raw.type === `${this.eventPrefix}_error`) {
      return this.fail(stringify(raw.message) || `${this.provider} ACP failed`);
    }

    switch (raw.sessionUpdate) {
      case 'usage_update': {
        const usage = this.extractUsageFromUsageUpdate(raw);
        if (usage) this.lastUsage = usage;
        const costUsd = this.toCostUsd(raw.cost);
        if (costUsd !== undefined) this.lastCostUsd = costUsd;
        return [];
      }
      case 'agent_message_chunk': {
        const text = (raw.content as { text?: unknown } | null)?.text;
        return typeof text === 'string' && text
          ? [
              ...this.stream.ensureStream(true),
              this.stream.event('stream_chunk', {
                chunkType: 'text',
                content: text,
              } satisfies StreamChunkData),
            ]
          : [];
      }
      case 'agent_thought_chunk': {
        const reasoning = (raw.content as { text?: unknown } | null)?.text;
        return typeof reasoning === 'string' && reasoning
          ? [
              ...this.stream.ensureStream(true),
              this.stream.event('stream_chunk', {
                chunkType: 'reasoning',
                reasoning,
              } satisfies StreamChunkData),
            ]
          : [];
      }
      case 'tool_call': {
        return this.startTool(raw);
      }
      case 'tool_call_update': {
        return this.updateTool(raw);
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    return this.complete('end_turn', this.lastUsage, this.lastCostUsd);
  }

  private updateTool(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    const id = raw.toolCallId;
    if (typeof id !== 'string' || this.completedTools.has(id)) return [];
    const startEvents = this.pendingTools.has(id) ? [] : this.startTool(raw);
    const resultState = this.mergeToolResultState(id, raw);
    if (raw.status === 'running' || raw.status === 'in_progress' || raw.status === 'pending') {
      const snapshotSeq = (this.snapshotSeq.get(id) ?? 0) + 1;
      this.snapshotSeq.set(id, snapshotSeq);
      return [
        ...startEvents,
        this.stream.event('stream_chunk', {
          chunkType: 'tool_state',
          pluginState: { ...raw },
          snapshotMode: 'replace',
          snapshotSeq,
          toolCallId: id,
        } satisfies ToolStateChunkData),
      ];
    }
    if (raw.status !== 'completed' && raw.status !== 'failed') return [];
    this.completedTools.add(id);
    this.pendingTools.delete(id);
    const isSuccess = raw.status === 'completed';
    const result =
      resultState.latest === 'content'
        ? toolContent(resultState.content, resultState.rawOutput ?? resultState.output)
        : stringify(
            resultState.latest === 'rawOutput' ? resultState.rawOutput : resultState.output,
          );
    const events = [
      ...startEvents,
      this.stream.event('tool_result', {
        content: result,
        isError: !isSuccess,
        toolCallId: id,
      } satisfies ToolResultData),
      this.stream.event('tool_end', { isSuccess, toolCallId: id }),
    ];
    if (this.pendingTools.size === 0) this.stream.pendingStepBoundary = true;
    return events;
  }

  private startTool(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    const id = raw.toolCallId;
    if (typeof id !== 'string' || this.completedTools.has(id)) return [];
    this.mergeToolResultState(id, raw);
    if (this.pendingTools.has(id)) return [];

    const apiName = [raw.name, raw.title, raw.kind].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const payload: ToolCallPayload = {
      apiName: apiName ?? 'unknown',
      arguments: stringify(raw.rawInput ?? raw.input ?? raw.parameters ?? {}),
      id,
      identifier:
        typeof raw.identifier === 'string' && raw.identifier ? raw.identifier : this.provider,
      type: 'default',
    };
    const streamEvents = this.stream.ensureStream(true);
    this.pendingTools.add(id);
    this.stream.stepTools.push(payload);

    return [
      ...streamEvents,
      this.stream.event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stream.stepTools],
      } satisfies StreamChunkData),
      this.stream.event('tool_start', { toolCalling: payload, toolCallId: id }),
    ];
  }

  private mergeToolResultState(toolCallId: string, raw: TraeAcpPayload): TraeAcpToolResultState {
    const state = this.toolResultStateById.get(toolCallId) ?? {};
    if (raw.content !== undefined) state.content = raw.content;
    if (raw.rawOutput !== undefined) state.rawOutput = raw.rawOutput;
    if (raw.output !== undefined) state.output = raw.output;
    if (raw.content !== undefined) state.latest = 'content';
    else if (raw.rawOutput !== undefined) state.latest = 'rawOutput';
    else if (raw.output !== undefined) state.latest = 'output';
    this.toolResultStateById.set(toolCallId, state);
    return state;
  }

  private closePending(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingTools].map((toolCallId) =>
      this.stream.event('tool_end', { isSuccess: false, toolCallId }),
    );
    this.pendingTools.clear();
    return events;
  }

  protected complete(
    stopReason: unknown,
    usage?: UsageData,
    costUsd?: number,
  ): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    const runtimeEndData =
      stopReason === 'cancelled' ? { reason: 'interrupted', stopReason } : { stopReason };

    const result: HeterogeneousAgentEvent[] = [
      ...this.closePending(),
      ...this.stream.closeStream({ stopReason }),
      this.stream.event('visible_output_end', {}),
    ];

    if (usage) {
      if (costUsd !== undefined) usage.cost = costUsd;
      const stepCompleteData: StepCompleteData = {
        model: this.model,
        phase: 'turn_metadata',
        provider: this.provider,
        usage,
      };
      result.push(this.stream.event('step_complete', stepCompleteData));
    }

    result.push(this.stream.event('agent_runtime_end', runtimeEndData));
    return result;
  }

  /**
   * Convert an ACP experimental `Usage` shape into the shared `UsageData`.
   * Returns `undefined` when required fields are missing or invalid.
   */
  protected toUsageData(usage: unknown): UsageData | undefined {
    if (!isRecord(usage)) return;

    const total = toFiniteNumber(usage.totalTokens) ?? toFiniteNumber(usage.total_tokens);
    const input = toFiniteNumber(usage.inputTokens) ?? toFiniteNumber(usage.input_tokens);
    const output = toFiniteNumber(usage.outputTokens) ?? toFiniteNumber(usage.output_tokens);
    if (typeof input !== 'number' || typeof output !== 'number' || input < 0 || output < 0) return;

    const cachedRead =
      toFiniteNumber(usage.cachedReadTokens) ??
      toFiniteNumber(usage.cached_read_tokens) ??
      toFiniteNumber(usage.cacheReadTokens) ??
      toFiniteNumber(usage.cache_read_tokens) ??
      0;
    const cachedWrite =
      toFiniteNumber(usage.cachedWriteTokens) ??
      toFiniteNumber(usage.cached_write_tokens) ??
      toFiniteNumber(usage.cacheWriteTokens) ??
      toFiniteNumber(usage.cache_write_tokens) ??
      0;
    const thought =
      toFiniteNumber(usage.thoughtTokens) ??
      toFiniteNumber(usage.thought_tokens) ??
      toFiniteNumber(usage.reasoningTokens) ??
      toFiniteNumber(usage.reasoning_tokens) ??
      0;

    const inputCacheMiss = Math.max(0, input - cachedRead);
    const outputText = Math.max(0, output - thought);
    const totalTokens = total ?? input + output + cachedWrite;

    return {
      inputCachedTokens: cachedRead || undefined,
      inputCacheMissTokens: inputCacheMiss,
      inputWriteCacheTokens: cachedWrite || undefined,
      outputReasoningTokens: thought || undefined,
      outputTextTokens: outputText,
      totalInputTokens: input + cachedWrite,
      totalOutputTokens: output,
      totalTokens,
    };
  }

  /**
   * Extract token usage from a `usage_update` notification.
   * The ACP spec only requires `used`/`size`/`cost`; per-turn token breakdown
   * lives in `_meta` as vendor extensions. Subclasses may override this to
   * parse provider-specific `_meta` keys (e.g. `cognition.ai/*Tokens`).
   */
  protected extractUsageFromUsageUpdate(_raw: TraeAcpPayload): UsageData | undefined {
    return;
  }

  /** Extract a USD cost amount from an ACP `cost` object. */
  private toCostUsd(cost: unknown): number | undefined {
    if (!isRecord(cost)) return;
    if (cost.currency !== 'USD') return;
    const amount = toFiniteNumber(cost.amount);
    if (amount === undefined || amount <= 0) return;
    return amount;
  }

  private fail(message: string): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    return [
      ...this.closePending(),
      ...this.stream.closeStream(),
      this.stream.event('visible_output_end', {}),
      this.stream.event('error', { agentType: this.provider, error: message, message }),
    ];
  }
}
