import {
  buildHeterogeneousAgentAuthRequiredError,
  getHeterogeneousAgentConfigOrThrow,
  isHeterogeneousAgentAuthRequired,
} from '../config';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

const GROK_BUILD_IDENTIFIER = 'grok-build';
const GROK_BUILD_AUTH_DOCS_URL =
  getHeterogeneousAgentConfigOrThrow(GROK_BUILD_IDENTIFIER).auth.docsUrl;

interface AcpUsage {
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cacheCreationInputTokens?: unknown;
  cacheCreationTokens?: unknown;
  cachedReadTokens?: unknown;
  cacheReadInputTokens?: unknown;
  input_tokens?: unknown;
  inputTokens?: unknown;
  output_tokens?: unknown;
  outputTokens?: unknown;
  reasoning_tokens?: unknown;
  reasoningTokens?: unknown;
  total_tokens?: unknown;
  totalTokens?: unknown;
}

interface GrokToolResultState {
  content?: unknown;
  rawOutput?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const toUsageData = (usage: unknown): UsageData | undefined => {
  if (!isRecord(usage)) return;

  const value = usage as AcpUsage;
  const input = finiteNumber(value.inputTokens ?? value.input_tokens);
  const output = finiteNumber(value.outputTokens ?? value.output_tokens);
  const cached = finiteNumber(
    value.cacheReadInputTokens ?? value.cachedReadTokens ?? value.cache_read_input_tokens,
  );
  const cacheCreation = finiteNumber(
    value.cacheCreationInputTokens ??
      value.cacheCreationTokens ??
      value.cache_creation_input_tokens,
  );
  const reasoning = Math.min(output, finiteNumber(value.reasoningTokens ?? value.reasoning_tokens));
  const totalInput = Math.max(input, cached + cacheCreation);
  const totalOutput = output;
  const totalTokens =
    finiteNumber(value.totalTokens ?? value.total_tokens) || totalInput + totalOutput;

  if (totalTokens === 0) return;

  return {
    inputCachedTokens: cached || undefined,
    inputCacheMissTokens: Math.max(0, totalInput - cached - cacheCreation),
    inputWriteCacheTokens: cacheCreation || undefined,
    outputReasoningTokens: reasoning || undefined,
    outputTextTokens: Math.max(0, output - reasoning) || undefined,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens,
  };
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const contentBlockText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (isRecord(value.content)) return contentBlockText(value.content);
  if (typeof value.diff === 'string') return value.diff;
  if (typeof value.output === 'string') return value.output;
  return '';
};

const toolResultContent = (update: GrokToolResultState): string => {
  const content = Array.isArray(update.content)
    ? update.content.map(contentBlockText).filter(Boolean).join('\n\n')
    : contentBlockText(update.content);
  return content || stringifyUnknown(update.rawOutput);
};

const isReplay = (raw: Record<string, unknown>): boolean => {
  const params = isRecord(raw.params) ? raw.params : undefined;
  const update = isRecord(params?.update) ? params.update : undefined;
  const paramsMeta = isRecord(params?._meta) ? params._meta : undefined;
  const updateMeta = isRecord(update?._meta) ? update._meta : undefined;
  return paramsMeta?.isReplay === true || updateMeta?.isReplay === true;
};

const eventIdOf = (raw: Record<string, unknown>): string | undefined => {
  const params = isRecord(raw.params) ? raw.params : undefined;
  const meta = isRecord(params?._meta) ? params._meta : undefined;
  return typeof meta?.eventId === 'string' ? meta.eventId : undefined;
};

/** Maps ACP v1 JSON-RPC messages from Grok Build into the shared event contract. */
export class GrokBuildAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedToolCallIds = new Set<string>();
  private pendingStepBoundary = false;
  private seenEventIds = new Set<string>();
  private settled = false;
  private lastTurnUsage?: { stepIndex: number; usage: UsageData };
  private started = false;
  private stepIndex = 0;
  private stepToolCalls: ToolCallPayload[] = [];
  private streamOpen = false;
  private toolPayloadById = new Map<string, ToolCallPayload>();
  private toolResultStateById = new Map<string, GrokToolResultState>();

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(raw) || isReplay(raw)) return [];

    const eventId = eventIdOf(raw);
    if (eventId) {
      if (this.seenEventIds.has(eventId)) return [];
      this.seenEventIds.add(eventId);
    }

    if (isRecord(raw.result) && typeof raw.result.sessionId === 'string') {
      this.sessionId = raw.result.sessionId;
    }

    if (isRecord(raw.error)) {
      const requestMethod = typeof raw.requestMethod === 'string' ? raw.requestMethod : undefined;
      return this.handleRpcError(raw.error, requestMethod);
    }
    if (raw.method === 'x.ai/session/prompt_complete') {
      return this.handlePromptComplete(raw.params);
    }
    if (
      raw.method === 'session/update' ||
      raw.method === 'x.ai/session_notification' ||
      raw.method === 'x.ai/session/update' ||
      raw.method === '_x.ai/session/update'
    ) {
      return this.handleNotification(raw.params);
    }
    if (isRecord(raw.result) && typeof raw.result.stopReason === 'string') {
      return this.handlePromptResult(raw.result);
    }

    return [];
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.settled) return [];
    return this.closeStream();
  }

  private handleNotification(paramsValue: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(paramsValue)) return [];
    if (typeof paramsValue.sessionId === 'string') this.sessionId = paramsValue.sessionId;

    const update = isRecord(paramsValue.update) ? paramsValue.update : undefined;
    if (!update || typeof update.sessionUpdate !== 'string') return [];

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = contentBlockText(update.content);
        if (!text) return [];
        return [
          ...this.ensureStream(true),
          this.makeEvent('stream_chunk', {
            chunkType: 'text',
            content: text,
          } satisfies StreamChunkData),
        ];
      }
      case 'agent_thought_chunk': {
        const reasoning = contentBlockText(update.content);
        if (!reasoning) return [];
        return [
          ...this.ensureStream(true),
          this.makeEvent('stream_chunk', {
            chunkType: 'reasoning',
            reasoning,
          } satisfies StreamChunkData),
        ];
      }
      case 'tool_call': {
        return this.handleToolCall(update);
      }
      case 'tool_call_update': {
        return this.handleToolCallUpdate(update);
      }
      case 'response_completed': {
        return this.handleResponseCompleted(update);
      }
      case 'turn_completed': {
        // Grok emits one durable turn_completed update after the final
        // response_completed for the prompt. The standard session/prompt
        // response owns terminal lifecycle, so processing this again would
        // duplicate final-turn usage and step metadata.
        return [];
      }
      default: {
        // ACP is intentionally extensible. Unknown session updates must not
        // break an otherwise valid prompt.
        return [];
      }
    }
  }

  private handleToolCall(update: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const toolCallId = update.toolCallId;
    if (typeof toolCallId !== 'string' || this.toolPayloadById.has(toolCallId)) return [];

    const kind = typeof update.kind === 'string' && update.kind ? update.kind : undefined;
    const title = typeof update.title === 'string' && update.title ? update.title : undefined;
    const tool: ToolCallPayload = {
      apiName: kind === 'execute' ? kind : (title ?? kind ?? 'tool'),
      arguments: stringifyUnknown(update.rawInput ?? {}),
      id: toolCallId,
      identifier: GROK_BUILD_IDENTIFIER,
      type: 'default',
    };
    this.toolPayloadById.set(toolCallId, tool);
    this.mergeToolResultState(toolCallId, update);
    this.stepToolCalls.push(tool);

    return [
      ...this.ensureStream(false),
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stepToolCalls],
      } satisfies StreamChunkData),
      this.makeEvent('tool_start', { toolCalling: tool, toolCallId }),
    ];
  }

  private handleToolCallUpdate(update: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const toolCallId = update.toolCallId;
    if (typeof toolCallId !== 'string' || this.completedToolCallIds.has(toolCallId)) return [];
    const resultState = this.mergeToolResultState(toolCallId, update);
    if (update.status !== 'completed' && update.status !== 'failed') return [];

    const tool = this.toolPayloadById.get(toolCallId);
    if (!tool) return [];

    this.completedToolCallIds.add(toolCallId);
    const isError = update.status === 'failed';
    const content = toolResultContent(resultState);
    const result: ToolResultData = { content, isError, toolCallId };

    return [
      ...this.ensureStream(false),
      this.makeEvent('tool_result', result),
      this.makeEvent('tool_end', {
        isSuccess: !isError,
        payload: { toolCalling: tool },
        result: { content, success: !isError },
        toolCallId,
      }),
    ];
  }

  private mergeToolResultState(
    toolCallId: string,
    update: Record<string, unknown>,
  ): GrokToolResultState {
    const state = this.toolResultStateById.get(toolCallId) ?? {};
    if (update.content !== undefined) state.content = update.content;
    if (update.rawOutput !== undefined) state.rawOutput = update.rawOutput;
    this.toolResultStateById.set(toolCallId, state);
    return state;
  }

  private handlePromptComplete(paramsValue: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(paramsValue)) return [];
    if (typeof paramsValue.sessionId === 'string') this.sessionId = paramsValue.sessionId;

    // Grok sends this immediate extension notification before resolving the
    // standard session/prompt request. Per-response completion updates own
    // model-round usage, while the standard response owns terminal lifecycle.
    return [];
  }

  private handleResponseCompleted(update: Record<string, unknown>): HeterogeneousAgentEvent[] {
    // A pending boundary belongs after the tools requested by the previous
    // model response. Reaching the next response completion proves that the
    // next model round exists even when it emitted no text/thought chunks.
    const events = this.ensureStream(true);
    const usage = toUsageData(update.usage);
    this.lastTurnUsage = usage ? { stepIndex: this.stepIndex, usage } : undefined;
    const data: StepCompleteData = {
      phase: 'turn_metadata',
      provider: GROK_BUILD_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };
    this.pendingStepBoundary = (update.stopReason ?? update.stop_reason) === 'tool_use';
    return [...events, this.makeEvent('step_complete', data)];
  }

  private handlePromptResult(result: Record<string, unknown>): HeterogeneousAgentEvent[] {
    if (this.settled) return [];
    this.settled = true;

    const meta = isRecord(result._meta) ? result._meta : undefined;
    const usage = toUsageData(meta?.usage ?? meta);
    const model = typeof meta?.modelId === 'string' ? meta.modelId : undefined;
    const turnUsage =
      this.lastTurnUsage?.stepIndex === this.stepIndex ? this.lastTurnUsage.usage : undefined;
    const resultUsage: StepCompleteData = {
      phase: 'result_usage',
      provider: GROK_BUILD_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };

    return [
      ...this.ensureStream(false),
      ...(model
        ? [
            this.makeEvent('step_complete', {
              model,
              phase: 'turn_metadata',
              provider: GROK_BUILD_IDENTIFIER,
              ...(turnUsage ? { usage: turnUsage } : {}),
            } satisfies StepCompleteData),
          ]
        : []),
      this.makeEvent('step_complete', resultUsage),
      ...this.closeStream(),
      this.makeEvent('visible_output_end', {}),
      this.makeEvent('agent_runtime_end', {
        reason: result.stopReason === 'cancelled' ? 'cancelled' : 'complete',
        transport: 'acp-stdio',
      }),
    ];
  }

  private handleRpcError(
    error: Record<string, unknown>,
    requestMethod?: string,
  ): HeterogeneousAgentEvent[] {
    if (this.settled) return [];
    this.settled = true;

    const message = typeof error.message === 'string' ? error.message : 'Grok Build request failed';
    const dataText = stringifyUnknown(error.data);
    const detail = [message, dataText].filter(Boolean).join(': ');
    const authRequired = isHeterogeneousAgentAuthRequired(GROK_BUILD_IDENTIFIER, detail);
    const data = authRequired
      ? buildHeterogeneousAgentAuthRequiredError({
          agentType: GROK_BUILD_IDENTIFIER,
          stderr: detail,
        })
      : {
          agentType: GROK_BUILD_IDENTIFIER,
          details: {
            code: error.code,
            data: error.data,
            ...(requestMethod ? { method: requestMethod } : {}),
          },
          docsUrl: GROK_BUILD_AUTH_DOCS_URL,
          message: detail,
          stderr: detail,
        };

    return [...this.closeStream(), this.makeEvent('error', data)];
  }

  private ensureStream(consumeStepBoundary: boolean): HeterogeneousAgentEvent[] {
    const events: HeterogeneousAgentEvent[] = [];
    if (consumeStepBoundary && this.pendingStepBoundary) {
      events.push(...this.closeStream());
      this.pendingStepBoundary = false;
      this.stepIndex += 1;
      this.stepToolCalls = [];
    }
    if (this.streamOpen) return events;

    this.started = true;
    this.streamOpen = true;
    const data: StreamStartData & { newStep?: boolean } = {
      provider: GROK_BUILD_IDENTIFIER,
      sessionId: this.sessionId,
      ...(this.stepIndex > 0 ? { newStep: true } : {}),
    };
    events.push(this.makeEvent('stream_start', data));
    return events;
  }

  private closeStream(): HeterogeneousAgentEvent[] {
    if (!this.started || !this.streamOpen) return [];
    this.streamOpen = false;
    return [this.makeEvent('stream_end', {})];
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }
}
