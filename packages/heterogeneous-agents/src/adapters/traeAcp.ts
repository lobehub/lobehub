import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StreamChunkData,
  ToolCallPayload,
  ToolResultData,
  ToolStateChunkData,
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

interface TraeAcpPayload {
  [key: string]: unknown;
  content?: unknown;
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
  status?: unknown;
  stopReason?: unknown;
  title?: unknown;
  toolCallId?: unknown;
  type?: unknown;
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
  private model?: string;
  private pendingTools = new Set<string>();
  private snapshotSeq = new Map<string, number>();
  private readonly stream = new AcpStreamLifecycle((stepIndex) => ({
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
    if (raw.type === `${this.eventPrefix}_prompt_completed`) return this.complete(raw.stopReason);
    if (raw.type === `${this.eventPrefix}_error`) {
      return this.fail(stringify(raw.message) || `${this.provider} ACP failed`);
    }

    switch (raw.sessionUpdate) {
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
    return this.complete('end_turn');
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

  private complete(stopReason: unknown): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    const runtimeEndData =
      stopReason === 'cancelled' ? { reason: 'interrupted', stopReason } : { stopReason };
    return [
      ...this.closePending(),
      ...this.stream.closeStream({ stopReason }),
      this.stream.event('visible_output_end', {}),
      this.stream.event('agent_runtime_end', runtimeEndData),
    ];
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
