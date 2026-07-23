import { imagePlaceholder } from '../imageEcho';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  HeterogeneousToolResultImage,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  SubagentEventContext,
  SubagentSpawnMetadata,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

const AMP_IDENTIFIER = 'amp';
const AMP_DOCS_URL = 'https://ampcode.com/manual';

interface AmpUsage {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

interface NormalizedToolResult {
  content: string;
  images: HeterogeneousToolResultImage[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const toUsageData = (value: unknown): UsageData | undefined => {
  if (!isRecord(value)) return;

  const usage = value as AmpUsage;
  const inputCacheMissTokens = toFiniteNumber(usage.input_tokens) ?? 0;
  const inputCachedTokens = toFiniteNumber(usage.cache_read_input_tokens) ?? 0;
  const inputWriteCacheTokens = toFiniteNumber(usage.cache_creation_input_tokens) ?? 0;
  const totalOutputTokens = toFiniteNumber(usage.output_tokens) ?? 0;
  const hasUsage = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.output_tokens,
  ].some((tokenCount) => toFiniteNumber(tokenCount) !== undefined);

  if (!hasUsage) return;

  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;

  return {
    ...(inputCachedTokens > 0 ? { inputCachedTokens } : {}),
    inputCacheMissTokens,
    ...(inputWriteCacheTokens > 0 ? { inputWriteCacheTokens } : {}),
    outputTextTokens: totalOutputTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

const normalizeToolResult = (value: unknown): NormalizedToolResult => {
  if (typeof value === 'string') return { content: value, images: [] };
  if (!Array.isArray(value)) return { content: stringifyUnknown(value), images: [] };

  const images: HeterogeneousToolResultImage[] = [];
  const content = value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item)) return stringifyUnknown(item);

      if (item.type === 'tool_reference' && typeof item.tool_name === 'string') {
        return item.tool_name;
      }

      if (item.type === 'image') {
        const source = isRecord(item.source) ? item.source : undefined;
        const mediaType = typeof source?.media_type === 'string' ? source.media_type : 'image';

        if (source?.type === 'base64' && typeof source.data === 'string') {
          images.push({ data: source.data, mediaType });
        }

        return imagePlaceholder(mediaType);
      }

      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;

      return stringifyUnknown(item);
    })
    .filter(Boolean)
    .join('\n');

  return { content, images };
};

const toToolPayload = (block: Record<string, unknown>): ToolCallPayload | undefined => {
  if (typeof block.id !== 'string' || typeof block.name !== 'string') return;

  return {
    apiName: block.name,
    arguments: stringifyUnknown(block.input ?? {}),
    id: block.id,
    identifier: AMP_IDENTIFIER,
    type: 'default',
  };
};

const getErrorText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return;

  for (const key of ['message', 'error', 'detail', 'stderr']) {
    const nested = getErrorText(value[key]);
    if (nested) return nested;
  }
};

const getTerminalMessage = (raw: Record<string, unknown>): string =>
  getErrorText(raw.error) ||
  getErrorText(raw.result) ||
  getErrorText(raw.message) ||
  'Amp stopped before completing the request.';

const buildTerminalError = (raw: Record<string, unknown>): HeterogeneousTerminalErrorData => {
  const message = getTerminalMessage(raw);
  const isAuthError =
    /not authenticated|authentication|unauthorized|sign in|log in|amp_api_key|\b401\b/i.test(
      message,
    );
  const isRateLimitError = /rate[ -]?limit|too many requests|\b429\b/i.test(message);
  const details = {
    ...(toFiniteNumber(raw.duration_ms) === undefined
      ? {}
      : { durationMs: toFiniteNumber(raw.duration_ms) }),
    ...(toFiniteNumber(raw.num_turns) === undefined
      ? {}
      : { numTurns: toFiniteNumber(raw.num_turns) }),
    ...(typeof raw.session_id === 'string' ? { sessionId: raw.session_id } : {}),
    ...(typeof raw.subtype === 'string' ? { subtype: raw.subtype } : {}),
  };

  return {
    agentType: AMP_IDENTIFIER,
    clearEchoedContent: true,
    ...(isAuthError ? { code: 'auth_required', docsUrl: AMP_DOCS_URL } : {}),
    ...(isRateLimitError
      ? {
          code: 'rate_limit',
          docsUrl: AMP_DOCS_URL,
          rateLimitInfo: { status: 'rejected' },
        }
      : {}),
    details,
    error: getErrorText(raw.error),
    message,
    stderr: typeof raw.stderr === 'string' ? raw.stderr : undefined,
  };
};

/**
 * Adapter for AMP's `--stream-json-thinking --stream-json-input` protocol.
 *
 * AMP resembles Anthropic's message block format, but its live stream omits
 * assistant message ids and reports terminal failures through a JSON `result`
 * event even when the process exit code is zero. Keeping this adapter separate
 * prevents those semantics from leaking into Claude Code's mature state machine.
 */
export class AmpAdapter implements AgentEventAdapter {
  private announcedSubagentSpawns = new Set<string>();
  private completedToolCalls = new Set<string>();
  private hasMainAssistantTurn = false;
  private mainToolInputsById = new Map<string, Record<string, unknown>>();
  private pendingToolCalls = new Set<string>();
  private started = false;
  private stepIndex = 0;
  private subagentTurnCounters = new Map<string, number>();
  private terminalEmitted = false;
  private toolCallsByTurn = new Map<string, ToolCallPayload[]>();
  private toolPayloadById = new Map<string, ToolCallPayload>();
  private toolSubagentById = new Map<string, SubagentEventContext>();
  sessionId?: string;

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!isRecord(raw)) return [];

    this.captureSessionId(raw);

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
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    return this.drainPendingToolEndEvents();
  }

  private captureSessionId(raw: Record<string, unknown>): void {
    if (typeof raw.session_id === 'string' && raw.session_id) {
      this.sessionId = raw.session_id;
    }
  }

  private handleSystem(raw: Record<string, unknown>): HeterogeneousAgentEvent[] {
    if (raw.subtype !== 'init') return [];
    if (this.started) return [];

    this.started = true;
    return [this.makeEvent('stream_start', this.getStreamStartData())];
  }

  private handleAssistant(raw: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const message = isRecord(raw.message) ? raw.message : undefined;
    const content = Array.isArray(message?.content)
      ? message.content
      : typeof message?.content === 'string'
        ? [{ text: message.content, type: 'text' }]
        : [];
    const parentToolCallId =
      typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : undefined;

    if (parentToolCallId) {
      return this.handleSubagentAssistant(parentToolCallId, content, message?.usage ?? raw.usage);
    }

    const events = this.openMainAssistantTurn();
    const turnKey = `main:${this.stepIndex}`;

    for (const block of content) {
      if (!isRecord(block)) continue;

      if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
        events.push(
          this.makeEvent('stream_chunk', {
            chunkType: 'reasoning',
            reasoning: block.thinking,
          } satisfies StreamChunkData),
        );
        continue;
      }

      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        events.push(
          this.makeEvent('stream_chunk', {
            chunkType: 'text',
            content: block.text,
          } satisfies StreamChunkData),
        );
        continue;
      }

      if (block.type === 'tool_use') {
        const tool = toToolPayload(block);
        if (!tool) continue;

        if (isRecord(block.input)) this.mainToolInputsById.set(tool.id, block.input);
        events.push(...this.emitToolCall(tool, turnKey));
      }
    }

    const usage = toUsageData(message?.usage ?? raw.usage);
    if (usage) {
      events.push(
        this.makeEvent('step_complete', {
          phase: 'turn_metadata',
          provider: AMP_IDENTIFIER,
          usage,
        } satisfies StepCompleteData),
      );
    }

    return events;
  }

  private handleSubagentAssistant(
    parentToolCallId: string,
    content: unknown[],
    rawUsage: unknown,
  ): HeterogeneousAgentEvent[] {
    const turnNumber = (this.subagentTurnCounters.get(parentToolCallId) ?? 0) + 1;
    this.subagentTurnCounters.set(parentToolCallId, turnNumber);
    const subagentMessageId = `amp:${parentToolCallId}:${turnNumber}`;
    const subagent: SubagentEventContext = { parentToolCallId, subagentMessageId };
    const turnKey = `subagent:${subagentMessageId}`;
    const events: HeterogeneousAgentEvent[] = [];

    for (const block of content) {
      if (!isRecord(block)) continue;

      if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
        events.push(
          this.makeEvent('stream_chunk', {
            chunkType: 'reasoning',
            reasoning: block.thinking,
            subagent,
          } satisfies StreamChunkData),
        );
        continue;
      }

      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        events.push(
          this.makeEvent('stream_chunk', {
            chunkType: 'text',
            content: block.text,
            subagent,
          } satisfies StreamChunkData),
        );
        continue;
      }

      if (block.type === 'tool_use') {
        const tool = toToolPayload(block);
        if (!tool) continue;
        events.push(...this.emitToolCall(tool, turnKey, subagent));
      }
    }

    const usage = toUsageData(rawUsage);
    if (usage) {
      events.push(
        this.makeEvent('step_complete', {
          phase: 'turn_metadata',
          provider: AMP_IDENTIFIER,
          subagent,
          usage,
        }),
      );
    }

    this.attachSpawnMetadata(events, parentToolCallId);
    return events;
  }

  private handleUser(raw: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const message = isRecord(raw.message) ? raw.message : undefined;
    if (!Array.isArray(message?.content)) return [];

    const parentToolCallId =
      typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : undefined;
    const subagent: SubagentEventContext | undefined = parentToolCallId
      ? { parentToolCallId }
      : undefined;
    const events: HeterogeneousAgentEvent[] = [];

    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      if (typeof block.tool_use_id !== 'string') continue;

      const toolCallId = block.tool_use_id;
      const normalized = normalizeToolResult(block.content);
      const pluginState = normalized.images.length > 0 ? { images: normalized.images } : undefined;
      const isError = block.is_error === true;
      const resultData: ToolResultData = {
        content: normalized.content,
        isError,
        ...(pluginState ? { pluginState } : {}),
        ...(subagent ? { subagent } : {}),
        toolCallId,
      };

      events.push(this.makeEvent('tool_result', resultData));

      if (!this.completedToolCalls.has(toolCallId)) {
        this.completedToolCalls.add(toolCallId);
        this.pendingToolCalls.delete(toolCallId);
        events.push(
          this.makeEvent(
            'tool_end',
            this.buildToolEndData(toolCallId, !isError, normalized.content, pluginState, subagent),
          ),
        );
      }
    }

    if (parentToolCallId) this.attachSpawnMetadata(events, parentToolCallId);
    return events;
  }

  private handleResult(raw: Record<string, unknown>): HeterogeneousAgentEvent[] {
    if (this.terminalEmitted) return [];
    this.terminalEmitted = true;

    const events = this.drainPendingToolEndEvents();
    if (this.started) {
      events.push(this.makeEvent('stream_end', {}));
      events.push(this.makeEvent('visible_output_end', {}));
    }

    const subtype = typeof raw.subtype === 'string' ? raw.subtype : '';
    const isError = raw.is_error === true || subtype.toLowerCase().includes('error');
    events.push(
      isError
        ? this.makeEvent('error', buildTerminalError(raw))
        : this.makeEvent('agent_runtime_end', {}),
    );
    this.clearRunState();

    return events;
  }

  private openMainAssistantTurn(): HeterogeneousAgentEvent[] {
    if (!this.started) {
      this.started = true;
      this.hasMainAssistantTurn = true;
      return [this.makeEvent('stream_start', this.getStreamStartData())];
    }

    if (!this.hasMainAssistantTurn) {
      this.hasMainAssistantTurn = true;
      return [];
    }

    this.stepIndex += 1;
    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', this.getStreamStartData({ newStep: true })),
    ];
  }

  private emitToolCall(
    tool: ToolCallPayload,
    turnKey: string,
    subagent?: SubagentEventContext,
  ): HeterogeneousAgentEvent[] {
    const tools = this.toolCallsByTurn.get(turnKey) ?? [];
    if (tools.some((existingTool) => existingTool.id === tool.id)) return [];

    const cumulativeTools = [...tools, tool];
    this.toolCallsByTurn.set(turnKey, cumulativeTools);
    this.toolPayloadById.set(tool.id, tool);
    this.pendingToolCalls.add(tool.id);
    if (subagent) this.toolSubagentById.set(tool.id, subagent);

    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        ...(subagent ? { subagent } : {}),
        toolsCalling: cumulativeTools,
      } satisfies StreamChunkData),
      this.makeEvent('tool_start', {
        ...(subagent ? { subagent } : {}),
        toolCalling: tool,
      }),
    ];
  }

  private buildToolEndData(
    toolCallId: string,
    isSuccess: boolean,
    content = '',
    pluginState?: Record<string, unknown>,
    explicitSubagent?: SubagentEventContext,
  ): Record<string, unknown> {
    const toolCalling = this.toolPayloadById.get(toolCallId);
    const subagent = explicitSubagent ?? this.toolSubagentById.get(toolCallId);

    return {
      isSuccess,
      ...(toolCalling ? { payload: { toolCalling } } : {}),
      result: {
        content,
        success: isSuccess,
        ...(pluginState ? { state: pluginState } : {}),
      },
      ...(subagent ? { subagent } : {}),
      toolCallId,
    };
  }

  private drainPendingToolEndEvents(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingToolCalls].map((toolCallId) =>
      this.makeEvent('tool_end', this.buildToolEndData(toolCallId, false)),
    );

    this.pendingToolCalls.clear();
    return events;
  }

  private attachSpawnMetadata(events: HeterogeneousAgentEvent[], parentToolCallId: string): void {
    if (events.length === 0 || this.announcedSubagentSpawns.has(parentToolCallId)) return;

    const spawnMetadata = this.buildSpawnMetadata(parentToolCallId);
    if (!spawnMetadata) return;

    const firstEvent = events[0];
    const firstSubagent = isRecord(firstEvent.data?.subagent)
      ? firstEvent.data.subagent
      : { parentToolCallId };
    firstEvent.data = {
      ...firstEvent.data,
      subagent: { ...firstSubagent, spawnMetadata },
    };
    this.announcedSubagentSpawns.add(parentToolCallId);
  }

  private buildSpawnMetadata(parentToolCallId: string): SubagentSpawnMetadata | undefined {
    const input = this.mainToolInputsById.get(parentToolCallId);
    if (!input) return;

    return {
      description: typeof input.description === 'string' ? input.description : undefined,
      prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
      subagentType: typeof input.subagent_type === 'string' ? input.subagent_type : undefined,
    };
  }

  private getStreamStartData(extra: Record<string, unknown> = {}): StreamStartData {
    return {
      provider: AMP_IDENTIFIER,
      sessionId: this.sessionId,
      ...extra,
    };
  }

  private clearRunState(): void {
    this.mainToolInputsById.clear();
    this.toolCallsByTurn.clear();
    this.toolPayloadById.clear();
    this.toolSubagentById.clear();
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return {
      data,
      stepIndex: this.stepIndex,
      timestamp: Date.now(),
      type,
    };
  }
}
