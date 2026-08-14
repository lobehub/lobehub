import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StreamChunkData,
  ToolCallPayload,
  ToolResultData,
  ToolStateChunkData,
} from '../types';

const PROVIDER = 'trae';

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

export class TraeAcpAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedTools = new Set<string>();
  private model?: string;
  private pendingTools = new Set<string>();
  private snapshotSeq = new Map<string, number>();
  private started = false;
  private terminal = false;
  private tools: ToolCallPayload[] = [];

  adapt(value: unknown): HeterogeneousAgentEvent[] {
    if (!value || typeof value !== 'object' || this.terminal) return [];
    const raw = value as TraeAcpPayload;
    if (raw.type === 'session_configured') {
      if (typeof raw.model === 'string') this.model = raw.model;
      return [];
    }
    if (raw.type === 'trae_session') {
      if (typeof raw.sessionId === 'string') this.sessionId = raw.sessionId;
      if (typeof raw.model === 'string') this.model = raw.model;
      return [];
    }
    if (raw.type === 'trae_prompt_completed') return this.complete(raw.stopReason);
    if (raw.type === 'trae_error') return this.fail(stringify(raw.message) || 'TRAE ACP failed');

    switch (raw.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = (raw.content as { text?: unknown } | null)?.text;
        return typeof text === 'string' && text
          ? [
              ...this.ensureStarted(),
              this.event('stream_chunk', {
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
              ...this.ensureStarted(),
              this.event('stream_chunk', {
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
    if (raw.status === 'running' || raw.status === 'in_progress' || raw.status === 'pending') {
      const snapshotSeq = (this.snapshotSeq.get(id) ?? 0) + 1;
      this.snapshotSeq.set(id, snapshotSeq);
      return [
        ...startEvents,
        this.event('stream_chunk', {
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
    const result = toolContent(raw.content, raw.rawOutput ?? raw.output);
    return [
      ...startEvents,
      this.event('tool_result', {
        content: result,
        isError: !isSuccess,
        toolCallId: id,
      } satisfies ToolResultData),
      this.event('tool_end', { isSuccess, toolCallId: id }),
    ];
  }

  private startTool(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    const id = raw.toolCallId;
    if (typeof id !== 'string' || this.pendingTools.has(id) || this.completedTools.has(id)) {
      return [];
    }

    const apiName = [raw.name, raw.title, raw.kind].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const payload: ToolCallPayload = {
      apiName: apiName ?? 'unknown',
      arguments: stringify(raw.rawInput ?? raw.input ?? raw.parameters ?? {}),
      id,
      identifier: PROVIDER,
      type: 'default',
    };
    this.pendingTools.add(id);
    this.tools.push(payload);

    return [
      ...this.ensureStarted(),
      this.event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.tools],
      } satisfies StreamChunkData),
      this.event('tool_start', { toolCalling: payload, toolCallId: id }),
    ];
  }

  private ensureStarted(): HeterogeneousAgentEvent[] {
    if (this.started) return [];
    this.started = true;
    return [
      this.event('stream_start', {
        ...(this.model ? { model: this.model } : {}),
        provider: PROVIDER,
        sessionId: this.sessionId,
      }),
    ];
  }

  private closePending(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingTools].map((toolCallId) =>
      this.event('tool_end', { isSuccess: false, toolCallId }),
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
      ...(this.started ? [this.event('stream_end', { stopReason })] : []),
      this.event('visible_output_end', {}),
      this.event('agent_runtime_end', runtimeEndData),
    ];
  }

  private fail(message: string): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    return [
      ...this.closePending(),
      ...(this.started ? [this.event('stream_end', {})] : []),
      this.event('visible_output_end', {}),
      this.event('error', { agentType: PROVIDER, error: message, message }),
    ];
  }

  private event(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: 0, timestamp: Date.now(), type };
  }
}
