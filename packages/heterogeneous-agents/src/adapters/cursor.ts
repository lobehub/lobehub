import { getHeterogeneousAgentConfigOrThrow, isHeterogeneousAgentAuthRequired } from '../config';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
} from '../types';

const CURSOR_CONFIG = getHeterogeneousAgentConfigOrThrow('cursor');
const INCOMPLETE_TOOL_MESSAGE = 'Cursor ended before the tool call completed.';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const serialize = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value === undefined ? fallback : JSON.stringify(value);

const readAssistantText = (message: unknown): string => {
  if (!isRecord(message) || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => (block as { text: string }).text)
    .join('');
};

const readTool = (value: unknown) => {
  if (!isRecord(value)) return;
  const [apiName, details] = Object.entries(value)[0] ?? [];
  if (!apiName || !isRecord(details)) return;
  if (apiName === 'function') {
    return {
      apiName: typeof details.name === 'string' && details.name ? details.name : 'function',
      arguments: serialize(details.arguments, '{}'),
      result: details.result,
    };
  }
  return { apiName, arguments: serialize(details.args, '{}'), result: details.result };
};

const readContent = (value: unknown): string => {
  if (isRecord(value)) {
    if (typeof value.content === 'string') return value.content;
    if (typeof value.message === 'string') return value.message;
    if (typeof value.error === 'string') return value.error;
  }
  return serialize(value);
};

const readResult = (value: unknown): { content: string; isError: boolean } => {
  if (!isRecord(value)) return { content: readContent(value), isError: false };
  for (const key of ['rejected', 'error', 'failure'] as const) {
    if (key in value) return { content: readContent(value[key]), isError: true };
  }
  return 'success' in value
    ? { content: readContent(value.success), isError: false }
    : { content: readContent(value), isError: false };
};

/** Maps Cursor CLI headless stream-json output into the shared event protocol. */
export class CursorAdapter implements AgentEventAdapter {
  sessionId?: string;
  private assistantSegmentText = '';
  private completedTools = new Set<string>();
  private model?: string;
  private pendingTools = new Map<string, ToolCallPayload>();
  private started = false;
  private streamOpen = false;
  private terminal = false;

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(raw) || this.terminal) return [];
    if (typeof raw.session_id === 'string') this.sessionId = raw.session_id;
    if (raw.type === 'system' && raw.subtype === 'init') {
      if (typeof raw.model === 'string') this.model = raw.model;
      return this.ensureStart();
    }
    if (raw.type === 'assistant') return this.assistant(raw);
    if (raw.type === 'tool_call') return this.toolCall(raw);
    if (raw.type === 'result') return this.result(raw);
    return [];
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    const events = this.closePendingTools();
    if (this.streamOpen) events.push(...this.closeStream());
    return events;
  }

  private assistant(event: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const content = readAssistantText(event.message);
    if (!content) return [];
    const partial =
      typeof event.timestamp_ms === 'number' && typeof event.model_call_id !== 'string';
    let next = content;
    if (partial) this.assistantSegmentText += content;
    else if (content.startsWith(this.assistantSegmentText)) {
      next = content.slice(this.assistantSegmentText.length);
      this.assistantSegmentText = content;
    } else if (this.assistantSegmentText.startsWith(content)) next = '';
    else this.assistantSegmentText += content;
    return next
      ? [...this.ensureStart(), this.event('stream_chunk', { chunkType: 'text', content: next })]
      : [];
  }

  private toolCall(event: Record<string, unknown>): HeterogeneousAgentEvent[] {
    if (typeof event.call_id !== 'string') return [];
    const data = readTool(event.tool_call);
    if (!data) return [];
    const id = event.call_id;
    const tool: ToolCallPayload = {
      apiName: data.apiName,
      arguments: data.arguments,
      id,
      identifier: 'cursor',
      type: 'default',
    };
    if (event.subtype === 'started') {
      if (this.completedTools.has(id) || this.pendingTools.has(id)) return [];
      this.assistantSegmentText = '';
      this.pendingTools.set(id, tool);
      return [
        ...this.ensureStart(),
        this.event('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [tool] }),
        this.event('tool_start', { toolCallId: id }),
      ];
    }
    if (event.subtype !== 'completed' || this.completedTools.has(id)) return [];
    this.completedTools.add(id);
    const events = this.ensureStart();
    if (!this.pendingTools.has(id)) {
      events.push(
        this.event('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [tool] }),
        this.event('tool_start', { toolCallId: id }),
      );
    }
    this.pendingTools.delete(id);
    this.assistantSegmentText = '';
    const result = readResult(data.result);
    events.push(
      this.event('tool_result', { ...result, toolCallId: id } satisfies ToolResultData),
      this.event('tool_end', { isSuccess: !result.isError, toolCallId: id }),
    );
    return events;
  }

  private result(event: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const events = [...this.ensureStart(), ...this.closePendingTools()];
    if (this.streamOpen) events.push(...this.closeStream());
    this.terminal = true;
    if (event.subtype === 'error' || event.is_error === true) {
      const detail = typeof event.result === 'string' ? event.result : 'Cursor execution failed';
      const auth = isHeterogeneousAgentAuthRequired('cursor', detail);
      const data: HeterogeneousTerminalErrorData = {
        agentType: 'cursor',
        clearEchoedContent: true,
        ...(auth ? { code: 'auth_required', docsUrl: CURSOR_CONFIG.auth.docsUrl } : {}),
        message: auth ? CURSOR_CONFIG.auth.errorMessage : detail,
        stderr: detail,
      };
      events.push(this.event('error', data));
    } else {
      // result.result is cumulative assistant text and must not be appended.
      events.push(this.event('agent_runtime_end', {}));
    }
    return events;
  }

  private ensureStart(): HeterogeneousAgentEvent[] {
    if (this.started) return [];
    this.started = true;
    this.streamOpen = true;
    const data: StreamStartData = {
      model: this.model,
      provider: 'cursor',
      sessionId: this.sessionId,
    };
    return [this.event('stream_start', data)];
  }

  private closePendingTools(): HeterogeneousAgentEvent[] {
    const events: HeterogeneousAgentEvent[] = [];
    for (const toolCallId of this.pendingTools.keys()) {
      events.push(
        this.event('tool_result', {
          content: INCOMPLETE_TOOL_MESSAGE,
          isError: true,
          toolCallId,
        } satisfies ToolResultData),
        this.event('tool_end', { isSuccess: false, toolCallId }),
      );
    }
    this.pendingTools.clear();
    return events;
  }

  private closeStream() {
    this.streamOpen = false;
    return [this.event('stream_end', {}), this.event('visible_output_end', {})];
  }

  private event(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: 0, timestamp: Date.now(), type };
  }
}
