import { isRecord } from '@lobechat/utils/object';

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
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';
import {
  acpContentBlockText,
  acpEventIdOf,
  AcpStreamLifecycle,
  isAcpReplayMessage,
} from './acpCommon';

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

const toolResultContent = (update: GrokToolResultState): string => {
  const content = Array.isArray(update.content)
    ? update.content.map(acpContentBlockText).filter(Boolean).join('\n\n')
    : acpContentBlockText(update.content);
  return content || stringifyUnknown(update.rawOutput);
};

/** Maps ACP v1 JSON-RPC messages from Grok Build into the shared event contract. */
export class GrokBuildAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedToolCallIds = new Set<string>();
  private seenEventIds = new Set<string>();
  private settled = false;
  private lastTurnUsage?: { stepIndex: number; usage: UsageData };
  private readonly stream = new AcpStreamLifecycle((stepIndex) => ({
    provider: GROK_BUILD_IDENTIFIER,
    sessionId: this.sessionId,
    ...(stepIndex > 0 ? { newStep: true } : {}),
  }));
  private toolPayloadById = new Map<string, ToolCallPayload>();
  private toolResultStateById = new Map<string, GrokToolResultState>();

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(raw) || isAcpReplayMessage(raw)) return [];

    const eventId = acpEventIdOf(raw);
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
    return this.stream.closeStream();
  }

  private handleNotification(paramsValue: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(paramsValue)) return [];
    if (typeof paramsValue.sessionId === 'string') this.sessionId = paramsValue.sessionId;

    const update = isRecord(paramsValue.update) ? paramsValue.update : undefined;
    if (!update || typeof update.sessionUpdate !== 'string') return [];

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = acpContentBlockText(update.content);
        if (!text) return [];
        return [
          ...this.stream.ensureStream(true),
          this.stream.event('stream_chunk', {
            chunkType: 'text',
            content: text,
          } satisfies StreamChunkData),
        ];
      }
      case 'agent_thought_chunk': {
        const reasoning = acpContentBlockText(update.content);
        if (!reasoning) return [];
        return [
          ...this.stream.ensureStream(true),
          this.stream.event('stream_chunk', {
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
    this.stream.stepTools.push(tool);

    return [
      ...this.stream.ensureStream(false),
      this.stream.event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stream.stepTools],
      } satisfies StreamChunkData),
      this.stream.event('tool_start', { toolCalling: tool, toolCallId }),
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
    // ACP providers do not consistently report `tool_use` on the preceding
    // response_completed update. A model chunk emitted after a completed tool
    // necessarily belongs to the next model round, so keep that boundary here
    // as well. `ensureStream(false)` leaves it pending through the remaining
    // parallel tool updates; the next text/thought chunk consumes it.
    this.stream.pendingStepBoundary = true;
    const isError = update.status === 'failed';
    const content = toolResultContent(resultState);
    const result: ToolResultData = { content, isError, toolCallId };

    return [
      ...this.stream.ensureStream(false),
      this.stream.event('tool_result', result),
      this.stream.event('tool_end', {
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
    const events = this.stream.ensureStream(true);
    const usage = toUsageData(update.usage);
    this.lastTurnUsage = usage ? { stepIndex: this.stream.stepIndex, usage } : undefined;
    const data: StepCompleteData = {
      phase: 'turn_metadata',
      provider: GROK_BUILD_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };
    this.stream.pendingStepBoundary = (update.stopReason ?? update.stop_reason) === 'tool_use';
    return [...events, this.stream.event('step_complete', data)];
  }

  private handlePromptResult(result: Record<string, unknown>): HeterogeneousAgentEvent[] {
    if (this.settled) return [];
    this.settled = true;

    const meta = isRecord(result._meta) ? result._meta : undefined;
    const usage = toUsageData(meta?.usage ?? meta);
    const model = typeof meta?.modelId === 'string' ? meta.modelId : undefined;
    const turnUsage =
      this.lastTurnUsage?.stepIndex === this.stream.stepIndex
        ? this.lastTurnUsage.usage
        : undefined;
    const resultUsage: StepCompleteData = {
      phase: 'result_usage',
      provider: GROK_BUILD_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };

    return [
      ...this.stream.ensureStream(false),
      ...(model
        ? [
            this.stream.event('step_complete', {
              model,
              phase: 'turn_metadata',
              provider: GROK_BUILD_IDENTIFIER,
              ...(turnUsage ? { usage: turnUsage } : {}),
            } satisfies StepCompleteData),
          ]
        : []),
      this.stream.event('step_complete', resultUsage),
      ...this.stream.closeStream(),
      this.stream.event('visible_output_end', {}),
      this.stream.event('agent_runtime_end', {
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

    return [...this.stream.closeStream(), this.stream.event('error', data)];
  }
}
