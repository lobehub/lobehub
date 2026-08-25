import { getHeterogeneousAgentConfigOrThrow } from '../config';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  StepCompleteData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

const OPENCODE_IDENTIFIER = 'opencode';
const OPENCODE_TODO_WRITE_API = 'todowrite';
const OPENCODE_CLI_INSTALL_DOCS_URL =
  getHeterogeneousAgentConfigOrThrow(OPENCODE_IDENTIFIER).auth.docsUrl;
const AUTH_REQUIRED_PATTERNS = [
  /authentication/i,
  /not authenticated/i,
  /unauthorized/i,
  /invalid.*(?:credential|token|key)/i,
];

const finiteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const toUsageData = (tokens: any): UsageData => {
  const input = finiteNumber(tokens?.input);
  const output = finiteNumber(tokens?.output);
  const reasoning = finiteNumber(tokens?.reasoning);
  const cacheRead = finiteNumber(tokens?.cache?.read);
  const cacheWrite = finiteNumber(tokens?.cache?.write);
  const totalInput = input + cacheRead + cacheWrite;
  const totalOutput = output + reasoning;

  return {
    inputCachedTokens: cacheRead,
    inputCacheMissTokens: input,
    inputWriteCacheTokens: cacheWrite,
    outputReasoningTokens: reasoning,
    outputTextTokens: output,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens: finiteNumber(tokens?.total) || totalInput + totalOutput,
  };
};

const errorMessage = (error: any): string =>
  (typeof error?.data?.message === 'string' && error.data.message) ||
  (typeof error?.message === 'string' && error.message) ||
  (typeof error?.name === 'string' && error.name) ||
  'OpenCode execution failed';

const isAuthError = (error: any, message: string): boolean =>
  error?.name === 'ProviderAuthError' ||
  error?.data?.statusCode === 401 ||
  AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(message));

const synthesizeTodoWritePluginState = (value: unknown) => {
  if (!Array.isArray(value)) return;

  const items = value.flatMap((todo) => {
    if (!todo || typeof todo !== 'object') return [];

    const record = todo as Record<string, unknown>;
    const text = typeof record.content === 'string' ? record.content.trim() : '';
    if (!text) return [];

    // OpenCode's run renderer treats cancelled and unknown statuses as
    // unchecked items; the shared Todo UI uses the same three-state alphabet.
    const status =
      record.status === 'completed'
        ? 'completed'
        : record.status === 'in_progress'
          ? 'processing'
          : 'todo';

    return [{ status, text }];
  });

  return { todos: { items, updatedAt: new Date().toISOString() } };
};

/** Maps OpenCode's completed-part JSONL protocol into shared stream events. */
export class OpenCodeAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedPartIds = new Set<string>();
  private completedToolCallIds = new Set<string>();
  private started = false;
  private stepIndex = 0;
  private streamOpen = false;
  private terminalErrorEmitted = false;

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];
    if (typeof raw.sessionID === 'string') this.sessionId = raw.sessionID;

    switch (raw.type) {
      case 'step_start': {
        return this.handleStepStart(raw.part);
      }
      case 'step_finish': {
        return this.handleStepFinish(raw.part);
      }
      case 'text':
      case 'reasoning': {
        return this.handleContent(raw.type, raw.part);
      }
      case 'tool_use': {
        return this.handleTool(raw.part);
      }
      case 'error': {
        return this.handleError(raw.error);
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    if (!this.streamOpen) return [];
    this.streamOpen = false;
    return [this.makeEvent('stream_end', {})];
  }

  private handleStepStart(part: any): HeterogeneousAgentEvent[] {
    if (!part || part.type !== 'step-start' || !part.id || this.completedPartIds.has(part.id)) {
      return [];
    }
    this.completedPartIds.add(part.id);

    const events: HeterogeneousAgentEvent[] = [];
    if (this.started) {
      if (this.streamOpen) events.push(this.makeEvent('stream_end', {}));
      this.stepIndex += 1;
    } else {
      this.started = true;
    }
    this.streamOpen = true;
    const data: StreamStartData & { newStep?: boolean } = {
      provider: OPENCODE_IDENTIFIER,
      sessionId: this.sessionId,
      ...(this.stepIndex > 0 ? { newStep: true } : {}),
    };
    events.push(this.makeEvent('stream_start', data));
    return events;
  }

  private handleContent(type: 'reasoning' | 'text', part: any): HeterogeneousAgentEvent[] {
    if (!part || part.type !== type || !part.id || this.completedPartIds.has(part.id)) return [];
    this.completedPartIds.add(part.id);
    if (typeof part.text !== 'string' || !part.text) return [];

    return [
      this.makeEvent(
        'stream_chunk',
        type === 'text'
          ? { chunkType: 'text', content: part.text }
          : { chunkType: 'reasoning', reasoning: part.text },
      ),
    ];
  }

  private handleStepFinish(part: any): HeterogeneousAgentEvent[] {
    if (!part || part.type !== 'step-finish' || !part.id || this.completedPartIds.has(part.id)) {
      return [];
    }
    this.completedPartIds.add(part.id);
    const data: StepCompleteData = {
      costUsd: finiteNumber(part.cost),
      phase: 'turn_metadata',
      provider: OPENCODE_IDENTIFIER,
      usage: toUsageData(part.tokens),
    };
    return [this.makeEvent('step_complete', data)];
  }

  private handleTool(part: any): HeterogeneousAgentEvent[] {
    const state = part?.state;
    const callId = part?.callID;
    if (
      part?.type !== 'tool' ||
      typeof callId !== 'string' ||
      this.completedToolCallIds.has(callId) ||
      (state?.status !== 'completed' && state?.status !== 'error')
    ) {
      return [];
    }
    this.completedToolCallIds.add(callId);
    if (part.id) this.completedPartIds.add(part.id);

    const tool: ToolCallPayload = {
      apiName: typeof part.tool === 'string' ? part.tool : 'unknown',
      arguments: JSON.stringify(state.input ?? {}),
      id: callId,
      identifier: OPENCODE_IDENTIFIER,
      type: 'default',
    };
    const isError = state.status === 'error';
    const pluginState =
      !isError && part.tool === OPENCODE_TODO_WRITE_API
        ? synthesizeTodoWritePluginState(state.metadata?.todos ?? state.input?.todos)
        : undefined;
    const result: ToolResultData = {
      content: isError ? String(state.error ?? '') : String(state.output ?? ''),
      isError,
      ...(pluginState ? { pluginState } : {}),
      toolCallId: callId,
    };

    return [
      this.makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [tool] }),
      this.makeEvent('tool_result', result),
      this.makeEvent('tool_end', { isSuccess: !isError, toolCallId: callId }),
    ];
  }

  private handleError(error: any): HeterogeneousAgentEvent[] {
    if (this.terminalErrorEmitted) return [];
    this.terminalErrorEmitted = true;
    const message = errorMessage(error);
    const authRequired = isAuthError(error, message);
    const data: HeterogeneousTerminalErrorData = {
      agentType: OPENCODE_IDENTIFIER,
      clearEchoedContent: true,
      ...(authRequired ? { code: 'auth_required', docsUrl: OPENCODE_CLI_INSTALL_DOCS_URL } : {}),
      details: error && typeof error === 'object' ? error : undefined,
      message: authRequired
        ? 'OpenCode could not authenticate. Sign in again or refresh its credentials, then retry.'
        : message,
      stderr: message,
    };
    const events: HeterogeneousAgentEvent[] = [];
    if (this.streamOpen) {
      this.streamOpen = false;
      events.push(this.makeEvent('stream_end', {}));
    }
    events.push(this.makeEvent('error', data));
    return events;
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }
}
