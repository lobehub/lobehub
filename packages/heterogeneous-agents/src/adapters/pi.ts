import { getHeterogeneousAgentConfigOrThrow } from '../config';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  HeterogeneousToolResultImage,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

const PI_IDENTIFIER = 'pi';
const PI_CLI_INSTALL_DOCS_URL = getHeterogeneousAgentConfigOrThrow(PI_IDENTIFIER).auth.docsUrl;
const PI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid (?:authentication )?(?:credentials?|tokens?|api keys?)/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
  /no api key found/i,
  /no models available/i,
];

const finiteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const toUsageData = (usage: any): UsageData => {
  const input = finiteNumber(usage?.input);
  const output = finiteNumber(usage?.output);
  const cacheRead = finiteNumber(usage?.cacheRead);
  const cacheWrite = finiteNumber(usage?.cacheWrite);
  const reasoning = Math.min(output, finiteNumber(usage?.reasoning));
  const totalInput = input + cacheRead + cacheWrite;

  return {
    inputCachedTokens: cacheRead,
    inputCacheMissTokens: input,
    inputWriteCacheTokens: cacheWrite,
    outputReasoningTokens: reasoning,
    outputTextTokens: Math.max(0, output - reasoning),
    totalInputTokens: totalInput,
    totalOutputTokens: output,
    totalTokens: finiteNumber(usage?.totalTokens) || totalInput + output,
  };
};

const toToolPayload = (toolCall: any): ToolCallPayload | undefined => {
  if (!toolCall || typeof toolCall.id !== 'string') return;

  const apiName = typeof toolCall.name === 'string' ? toolCall.name : 'unknown';
  return {
    apiName,
    arguments: JSON.stringify(toolCall.arguments ?? {}),
    id: toolCall.id,
    identifier: PI_IDENTIFIER,
    type: 'default',
  };
};

const normalizeToolResult = (result: any): Pick<ToolResultData, 'content' | 'pluginState'> => {
  const images: HeterogeneousToolResultImage[] = [];
  const rawContent = result?.content;
  const content = Array.isArray(rawContent)
    ? rawContent
        .map((block: any) => {
          if (block?.type === 'text' && typeof block.text === 'string') return block.text;
          if (block?.type === 'image') {
            const mediaType =
              typeof block.mimeType === 'string'
                ? block.mimeType
                : typeof block.mediaType === 'string'
                  ? block.mediaType
                  : 'image';
            if (typeof block.data === 'string') images.push({ data: block.data, mediaType });
            return `[Image: ${mediaType}]`;
          }
          return typeof block?.content === 'string' ? block.content : '';
        })
        .filter(Boolean)
        .join('\n')
    : typeof rawContent === 'string'
      ? rawContent
      : result === undefined
        ? ''
        : JSON.stringify(result);

  return {
    content,
    ...(images.length > 0 ? { pluginState: { images } } : {}),
  };
};

/** Maps Pi's `--mode json` session event stream into shared heterogeneous events. */
export class PiAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedToolResults = new Set<string>();
  private emittedTextLengths = new Map<number, number>();
  private emittedThinkingLengths = new Map<number, number>();
  private executionResults = new Map<string, { isError: boolean; result: any }>();
  private pendingAssistantError?: any;
  private pendingToolCalls = new Set<string>();
  private settled = false;
  private started = false;
  private stepIndex = 0;
  private stepToolCallIds = new Set<string>();
  private stepToolCalls: ToolCallPayload[] = [];
  private streamOpen = false;
  private terminalErrorEmitted = false;
  private toolPayloadById = new Map<string, ToolCallPayload>();

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];

    switch (raw.type) {
      case 'session': {
        if (typeof raw.id === 'string') this.sessionId = raw.id;
        return [];
      }
      case 'turn_start': {
        return this.openTurn();
      }
      case 'message_update': {
        return this.handleMessageUpdate(raw.assistantMessageEvent);
      }
      case 'message_end': {
        return this.handleMessageEnd(raw.message);
      }
      case 'agent_end': {
        // Pi emits agent_end before post-run retry/compaction checks. Only
        // agent_settled means the whole prompt (including recovery) is done.
        return [];
      }
      case 'tool_execution_start': {
        return this.startTool({
          arguments: raw.args,
          id: raw.toolCallId,
          name: raw.toolName,
        });
      }
      case 'tool_execution_end': {
        if (typeof raw.toolCallId === 'string' && !this.completedToolResults.has(raw.toolCallId)) {
          this.executionResults.set(raw.toolCallId, {
            isError: raw.isError === true,
            result: raw.result,
          });
        }
        return [];
      }
      case 'turn_end': {
        return this.closeStream();
      }
      case 'auto_retry_start': {
        return [
          this.makeEvent('stream_retry', {
            agentType: PI_IDENTIFIER,
            attempt: raw.attempt,
            delayMs: raw.delayMs,
            error: raw.errorMessage,
            maxAttempts: raw.maxAttempts,
            provider: PI_IDENTIFIER,
          }),
        ];
      }
      case 'compaction_end': {
        if (
          this.pendingAssistantError &&
          typeof raw.errorMessage === 'string' &&
          raw.errorMessage
        ) {
          this.pendingAssistantError = {
            ...this.pendingAssistantError,
            errorMessage: raw.errorMessage,
            stopReason: 'error',
          };
        }
        return [];
      }
      case 'agent_settled': {
        return this.handleSettled();
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.settled || this.terminalErrorEmitted) return [];
    if (this.pendingAssistantError) {
      const error = this.pendingAssistantError;
      this.pendingAssistantError = undefined;
      return this.emitAssistantError(error);
    }
    this.settled = true;

    return [
      ...this.flushExecutionResults(),
      ...this.drainPendingTools(),
      ...this.closeStream(),
      this.makeEvent('visible_output_end', {}),
      this.makeEvent('agent_runtime_end', {}),
    ];
  }

  private openTurn(): HeterogeneousAgentEvent[] {
    if (this.settled || this.terminalErrorEmitted) return [];

    const events: HeterogeneousAgentEvent[] = [];
    if (this.started) {
      events.push(...this.closeStream());
      this.stepIndex += 1;
    } else {
      this.started = true;
    }

    this.stepToolCallIds.clear();
    this.stepToolCalls = [];
    this.emittedTextLengths.clear();
    this.emittedThinkingLengths.clear();
    this.streamOpen = true;
    const data: StreamStartData & { newStep?: boolean } = {
      provider: PI_IDENTIFIER,
      sessionId: this.sessionId,
      ...(this.stepIndex > 0 ? { newStep: true } : {}),
    };
    events.push(this.makeEvent('stream_start', data));
    return events;
  }

  private ensureTurn(): HeterogeneousAgentEvent[] {
    return this.streamOpen ? [] : this.openTurn();
  }

  private closeStream(): HeterogeneousAgentEvent[] {
    if (!this.streamOpen) return [];
    this.streamOpen = false;
    return [this.makeEvent('stream_end', {})];
  }

  private handleMessageUpdate(update: any): HeterogeneousAgentEvent[] {
    if (!update || typeof update !== 'object') return [];

    switch (update.type) {
      case 'text_delta': {
        if (typeof update.delta !== 'string' || !update.delta) return [];
        const turnEvents = this.ensureTurn();
        const contentIndex = finiteNumber(update.contentIndex);
        this.emittedTextLengths.set(
          contentIndex,
          (this.emittedTextLengths.get(contentIndex) ?? 0) + update.delta.length,
        );
        return [
          ...turnEvents,
          this.makeEvent('stream_chunk', {
            chunkType: 'text',
            content: update.delta,
          } satisfies StreamChunkData),
        ];
      }
      case 'thinking_delta': {
        if (typeof update.delta !== 'string' || !update.delta) return [];
        const turnEvents = this.ensureTurn();
        const contentIndex = finiteNumber(update.contentIndex);
        this.emittedThinkingLengths.set(
          contentIndex,
          (this.emittedThinkingLengths.get(contentIndex) ?? 0) + update.delta.length,
        );
        return [
          ...turnEvents,
          this.makeEvent('stream_chunk', {
            chunkType: 'reasoning',
            reasoning: update.delta,
          } satisfies StreamChunkData),
        ];
      }
      case 'toolcall_end': {
        return [...this.ensureTurn(), ...this.startTool(update.toolCall)];
      }
      case 'error': {
        const snapshotEvents = this.emitAssistantSnapshotSuffixes(update.error);
        return [
          ...snapshotEvents,
          ...(update.reason === 'aborted' || update.error?.stopReason === 'aborted'
            ? this.handleAborted()
            : this.deferAssistantError(update.error)),
        ];
      }
      default: {
        return [];
      }
    }
  }

  private handleMessageEnd(message: any): HeterogeneousAgentEvent[] {
    if (!message || typeof message !== 'object') return [];

    if (message.role === 'toolResult') {
      return this.completeTool(message.toolCallId, message, message.isError === true);
    }
    if (message.role !== 'assistant') return [];
    const snapshotEvents = this.emitAssistantSnapshotSuffixes(message);
    if (message.stopReason === 'aborted') return [...snapshotEvents, ...this.handleAborted()];
    if (message.stopReason === 'error') {
      return [...snapshotEvents, ...this.deferAssistantError(message)];
    }

    // A later successful assistant response supersedes an error from a prior
    // low-level run (for example, after Pi compacts and retries an overflow).
    this.pendingAssistantError = undefined;

    const model =
      typeof message.responseModel === 'string'
        ? message.responseModel
        : typeof message.model === 'string'
          ? message.model
          : undefined;
    const usage = message.usage ? toUsageData(message.usage) : undefined;
    if (!model && !usage) return snapshotEvents;

    const data: StepCompleteData = {
      ...(finiteNumber(message.usage?.cost?.total) > 0
        ? { costUsd: finiteNumber(message.usage.cost.total) }
        : {}),
      ...(model ? { model } : {}),
      phase: 'turn_metadata',
      provider: PI_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };
    return [...snapshotEvents, this.makeEvent('step_complete', data)];
  }

  private emitAssistantSnapshotSuffixes(message: any): HeterogeneousAgentEvent[] {
    if (!Array.isArray(message?.content)) return [];

    const events: HeterogeneousAgentEvent[] = [];
    for (const [contentIndex, block] of message.content.entries()) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const emittedLength = this.emittedTextLengths.get(contentIndex) ?? 0;
        const suffix = block.text.slice(emittedLength);
        this.emittedTextLengths.set(contentIndex, block.text.length);
        if (suffix) {
          events.push(
            this.makeEvent('stream_chunk', {
              chunkType: 'text',
              content: suffix,
            } satisfies StreamChunkData),
          );
        }
        continue;
      }
      if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        const emittedLength = this.emittedThinkingLengths.get(contentIndex) ?? 0;
        const suffix = block.thinking.slice(emittedLength);
        this.emittedThinkingLengths.set(contentIndex, block.thinking.length);
        if (suffix) {
          events.push(
            this.makeEvent('stream_chunk', {
              chunkType: 'reasoning',
              reasoning: suffix,
            } satisfies StreamChunkData),
          );
        }
        continue;
      }
      if (block?.type === 'toolCall') events.push(...this.startTool(block));
    }
    return events;
  }

  private startTool(toolCall: any): HeterogeneousAgentEvent[] {
    const tool = toToolPayload(toolCall);
    if (!tool || this.pendingToolCalls.has(tool.id) || this.completedToolResults.has(tool.id)) {
      return [];
    }

    this.pendingToolCalls.add(tool.id);
    this.toolPayloadById.set(tool.id, tool);
    if (!this.stepToolCallIds.has(tool.id)) {
      this.stepToolCallIds.add(tool.id);
      this.stepToolCalls.push(tool);
    }

    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stepToolCalls],
      } satisfies StreamChunkData),
      this.makeEvent('tool_start', { toolCalling: tool, toolCallId: tool.id }),
    ];
  }

  private completeTool(
    toolCallId: unknown,
    result: any,
    isError: boolean,
  ): HeterogeneousAgentEvent[] {
    if (typeof toolCallId !== 'string' || this.completedToolResults.has(toolCallId)) return [];

    this.completedToolResults.add(toolCallId);
    this.executionResults.delete(toolCallId);
    this.pendingToolCalls.delete(toolCallId);
    const normalized = normalizeToolResult(result);
    const toolCalling = this.toolPayloadById.get(toolCallId);
    const resultData = {
      ...normalized,
      isError,
      toolCallId,
    } satisfies ToolResultData;

    return [
      this.makeEvent('tool_result', resultData),
      this.makeEvent('tool_end', {
        isSuccess: !isError,
        ...(toolCalling ? { payload: { toolCalling } } : {}),
        result: {
          content: normalized.content,
          success: !isError,
          ...(normalized.pluginState ? { state: normalized.pluginState } : {}),
        },
        toolCallId,
      }),
    ];
  }

  private flushExecutionResults(): HeterogeneousAgentEvent[] {
    return [...this.executionResults].flatMap(([toolCallId, value]) =>
      this.completeTool(toolCallId, value.result, value.isError),
    );
  }

  private drainPendingTools(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingToolCalls].map((toolCallId) =>
      this.makeEvent('tool_end', { isSuccess: false, toolCallId }),
    );
    this.pendingToolCalls.clear();
    return events;
  }

  private deferAssistantError(message: any): HeterogeneousAgentEvent[] {
    if (this.terminalErrorEmitted || this.settled) return [];
    this.pendingAssistantError = message;
    return [];
  }

  private emitAssistantError(message: any): HeterogeneousAgentEvent[] {
    if (this.terminalErrorEmitted || this.settled) return [];
    this.terminalErrorEmitted = true;

    const rawMessage =
      typeof message?.errorMessage === 'string' && message.errorMessage
        ? message.errorMessage
        : 'Pi execution failed';
    const authRequired = PI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(rawMessage));
    const data: HeterogeneousTerminalErrorData = {
      agentType: PI_IDENTIFIER,
      clearEchoedContent: true,
      ...(authRequired ? { code: 'auth_required', docsUrl: PI_CLI_INSTALL_DOCS_URL } : {}),
      details: {
        ...(typeof message?.model === 'string' ? { model: message.model } : {}),
        ...(typeof message?.provider === 'string' ? { modelProvider: message.provider } : {}),
        ...(typeof message?.stopReason === 'string' ? { stopReason: message.stopReason } : {}),
      },
      message: authRequired
        ? 'Pi could not authenticate. Run `pi`, enter `/login`, then retry.'
        : rawMessage,
      stderr: rawMessage,
    };

    return [
      ...this.flushExecutionResults(),
      ...this.drainPendingTools(),
      ...this.closeStream(),
      this.makeEvent('visible_output_end', {}),
      this.makeEvent('error', data),
    ];
  }

  private handleAborted(): HeterogeneousAgentEvent[] {
    if (this.settled || this.terminalErrorEmitted) return [];
    this.settled = true;
    this.pendingAssistantError = undefined;

    return [
      ...this.flushExecutionResults(),
      ...this.drainPendingTools(),
      ...this.closeStream(),
      this.makeEvent('visible_output_end', {}),
      this.makeEvent('agent_runtime_end', { kind: 'aborted', reason: 'interrupted' }),
    ];
  }

  private handleSettled(): HeterogeneousAgentEvent[] {
    if (this.settled || this.terminalErrorEmitted) return [];
    if (this.pendingAssistantError) {
      const error = this.pendingAssistantError;
      this.pendingAssistantError = undefined;
      return this.emitAssistantError(error);
    }
    this.settled = true;

    return [
      ...this.flushExecutionResults(),
      ...this.drainPendingTools(),
      ...this.closeStream(),
      this.makeEvent('visible_output_end', {}),
      this.makeEvent('agent_runtime_end', {}),
    ];
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }
}
