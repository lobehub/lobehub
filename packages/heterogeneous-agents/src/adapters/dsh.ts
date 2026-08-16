import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  SessionTitleData,
  StepCompleteData,
  StreamChunkData,
  StreamStartData,
  SubagentEventContext,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

/** Adapter key in the runtime registry, and the `provider` reported on `step_complete`. */
const DSH_IDENTIFIER = 'deepseek-harness';

/**
 * JSON-RPC notification methods the `dsh-jsonrpc` runtime sends. Requests
 * (`initialize` / `session/prompt` / `shutdown`) are the session layer's
 * business — the adapter only reads the server-to-client stream.
 */
const SESSION_EVENT = 'session.event';
const SESSION_STATUS = 'session.status';
const SUBAGENT_STARTED = 'subagent.started';

/**
 * DeepSeek Harness token counts are DISJOINT: `inputTokens` excludes cache
 * reads and writes, so billed input is the sum of the three. `outputTokens`
 * follows the OpenAI convention and INCLUDES `reasoningTokens`, so the text
 * portion is the difference — do not add them.
 */
const toUsageData = (usage: any): UsageData | undefined => {
  if (!usage || typeof usage !== 'object') return undefined;

  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  const input = finite(usage.inputTokens);
  const cacheRead = finite(usage.cacheReadTokens);
  const cacheWrite = finite(usage.cacheWriteTokens);
  const output = finite(usage.outputTokens);
  const reasoning = finite(usage.reasoningTokens);
  const totalInput = input + cacheRead + cacheWrite;

  return {
    inputCachedTokens: cacheRead,
    inputCacheMissTokens: input,
    inputWriteCacheTokens: cacheWrite,
    outputReasoningTokens: reasoning,
    outputTextTokens: Math.max(output - reasoning, 0),
    totalInputTokens: totalInput,
    totalOutputTokens: output,
    totalTokens: totalInput + output,
  };
};

/** Flatten harness content blocks into the plain text LobeHub persists on a tool message. */
const flattenBlocks = (blocks: unknown): string => {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block: any) => {
      if (block?.type === 'text' || block?.type === 'reasoning') return block.text ?? '';
      if (block?.type === 'image') return '[Image]';
      return '';
    })
    .filter(Boolean)
    .join('');
};

/**
 * Pull the child's opening prompt out of the delegating call's raw arguments so
 * the child Thread seeds a readable user message instead of a JSON blob. The
 * arguments are the model's unparsed output, so malformed JSON is expected and
 * falls back to the raw string.
 */
const extractPrompt = (args: string | undefined): string | undefined => {
  if (!args) return undefined;
  try {
    const parsed = JSON.parse(args);
    const prompt = parsed?.prompt ?? parsed?.task ?? parsed?.input;
    return typeof prompt === 'string' ? prompt : args;
  } catch {
    // Model-produced JSON; an unparsable payload still reads better raw than dropped.
    return args;
  }
};

/** Per-child bookkeeping for a delegated session, keyed by the child session id. */
interface SubagentLink {
  parentToolCallId: string;
  /** Cleared once the spawn metadata has ridden out on the first child event. */
  pendingSpawn: boolean;
  spawnMetadata?: { description?: string; prompt?: string; subagentType?: string };
}

/**
 * Maps the DeepSeek Harness SDK runtime protocol
 * (`@deepseek-ai/dsh-sdk-jsonrpc-server`)
 * into shared stream events.
 *
 * Unlike the CLI adapters, the harness does not print a bespoke JSONL dialect:
 * it streams its own **session log** verbatim over newline-delimited JSON-RPC,
 * one `session.event` notification per appended log event. Raw
 * `assistant/chunk` deltas are part of that stream, so token-level output maps
 * across without an assembly pass here.
 *
 * `adapt` consumes parsed JSON-RPC frames. The session layer owns the
 * handshake and the prompt request; everything below is server-to-client.
 *
 * Two harness traits shape this mapping:
 *
 * 1. `session.event` carries **every session in the runtime**, not just the one
 *    we prompted — including delegated subagent sessions. The first session id
 *    seen becomes the root; a session linked by `subagent.started` is stamped
 *    with {@link SubagentEventContext}; anything else is dropped.
 * 2. The harness event vocabulary is merge-extensible by design (plugins add
 *    event types, content blocks, and finish reasons via declaration merging),
 *    and the wire format carries no compatibility promise pre-release.
 *    Every switch here therefore falls through unknown tags silently rather
 *    than asserting an exhaustive union.
 */
export class DshAdapter implements AgentEventAdapter {
  /** Root harness session id — reported for `--resume`-style continuation. */
  sessionId?: string;

  /**
   * @param rootSessionId - the session the caller prompted. An SDK client picks
   *   this id itself, so binding it up front stops a sibling session's event
   *   from claiming the root slot; omit it to adopt the first session seen.
   */
  constructor(rootSessionId?: string) {
    this.sessionId = rootSessionId;
  }

  private finished = false;
  /** A step has opened but has produced no output yet, so its stream is unopened. */
  private pendingStream = false;
  private route?: { model?: string; provider?: string };
  private stepCounter = 0;
  private stepIndex = 0;
  private streamOpen = false;
  private terminalErrorEmitted = false;

  /** Last dispatched tool call per session — correlates `subagent.started` to its spawning call. */
  private lastToolCallBySession = new Map<string, string>();
  private subagentByChildSession = new Map<string, SubagentLink>();
  private toolPayloadById = new Map<string, ToolCallPayload>();

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];

    switch (raw.method) {
      case SESSION_EVENT: {
        return this.handleSessionEvent(raw.params);
      }
      case SESSION_STATUS: {
        return this.handleStatus(raw.params);
      }
      case SUBAGENT_STARTED: {
        this.linkSubagent(raw.params);
        return [];
      }
      // `subagent.finished`, responses, and unknown methods carry nothing the
      // stream needs — the child's own session events already told the story.
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    const events: HeterogeneousAgentEvent[] = this.closeStream();
    if (!this.finished) {
      this.finished = true;
      events.push(this.makeEvent('agent_runtime_end', {}));
    }
    return events;
  }

  private handleSessionEvent(params: any): HeterogeneousAgentEvent[] {
    const sessionId = params?.sessionId;
    const event = params?.event;
    if (typeof sessionId !== 'string' || !event || typeof event.type !== 'string') return [];

    if (!this.sessionId) this.sessionId = sessionId;

    const isRoot = sessionId === this.sessionId;
    const subagent = isRoot ? undefined : this.subagentContextFor(sessionId);
    // A session that is neither the root nor a linked child belongs to another
    // client of the same runtime.
    if (!isRoot && !subagent) return [];

    const data = event.data ?? {};
    const events = this.routeSessionEvent(event.type, data, sessionId, subagent);

    // Spawn metadata must ride the first EMITTED child event, not merely the
    // first child event seen: a child session opens with lifecycle frames
    // (`turn/start`, `subagent/descriptor`) that map to nothing, and the
    // executor needs the metadata to create the child Thread.
    if (subagent && events.length > 0) this.attachSpawnMetadata(sessionId, events[0]);
    return events;
  }

  private routeSessionEvent(
    type: string,
    data: any,
    sessionId: string,
    subagent?: SubagentEventContext,
  ): HeterogeneousAgentEvent[] {
    switch (type) {
      case 'assistant/chunk': {
        return this.handleChunk(data.chunk, subagent);
      }
      case 'assistant/message': {
        return this.handleAssistantMessage(data, subagent);
      }
      // Every request logs its header inside the step before dispatch, so this
      // is the reliable route source. `request/context` repeats the pair but is
      // logged only when the route changes, which skips later same-route steps.
      case 'request/context': {
        this.route = { model: data.model, provider: data.provider };
        return [];
      }
      case 'request/header': {
        const config = data.header?.config;
        if (config) this.route = { model: config.model, provider: config.provider };
        return [];
      }
      // `dsh-llm-retry` records the wait before re-attempting a failed request.
      // Surfacing it keeps the renderer from showing a silent stall — and it is
      // why a terminal `finish` chunk must not be reported as a run failure.
      case 'llm/retry': {
        if (subagent) return [];
        return [
          this.makeEvent('stream_retry', {
            agentType: DSH_IDENTIFIER,
            attempt: data.retry,
            delayMs: data.delayMs,
            error: data.failure?.message,
            ...(data.maxRetries === undefined ? {} : { maxAttempts: data.maxRetries }),
            provider: DSH_IDENTIFIER,
          }),
        ];
      }
      case 'step/start': {
        return this.handleStepStart(subagent);
      }
      // The harness titles its own sessions, so the consumer can skip its own
      // summarization call. A delegated child titles its own session too; that
      // title describes the subtask, not the conversation.
      case 'session/title': {
        if (subagent) return [];
        return this.handleTitle(data);
      }
      // The delegated child logs its own descriptor, whose `label` is the
      // human-readable spawn title — better than the delegating tool's name.
      case 'subagent/descriptor': {
        const link = this.subagentByChildSession.get(sessionId);
        if (link?.pendingSpawn && data.label) {
          link.spawnMetadata = { ...link.spawnMetadata, description: data.label };
        }
        return [];
      }
      case 'tool/call': {
        return this.handleToolCall(sessionId, data, subagent);
      }
      case 'tool/result': {
        return this.handleToolResult(data, subagent);
      }
      case 'turn/end': {
        return this.handleTurnEnd(data, subagent);
      }
      default: {
        return [];
      }
    }
  }

  /**
   * One harness step is one model call, which is one LobeHub assistant message.
   * A subagent step stays inside the parent's step: its output is stamped and
   * routed to the child Thread, so opening a second main stream would split the
   * parent's assistant message in half.
   *
   * The step only opens a pending slot here. `stream_start` has to carry the
   * provider/model route, and the harness logs the route in the `request/header`
   * it appends INSIDE the step, after `step/start` and before dispatch — so the
   * stream is opened lazily by the step's first output instead.
   */
  private handleStepStart(subagent?: SubagentEventContext): HeterogeneousAgentEvent[] {
    if (subagent) return [];

    const events = this.closeStream();
    this.stepIndex = this.stepCounter;
    this.stepCounter += 1;
    this.pendingStream = true;
    return events;
  }

  private openStreamIfPending(): HeterogeneousAgentEvent[] {
    if (!this.pendingStream) return [];
    this.pendingStream = false;
    this.streamOpen = true;

    const data: StreamStartData & { newStep?: boolean } = {
      model: this.route?.model,
      ...(this.stepIndex > 0 ? { newStep: true } : {}),
      provider: DSH_IDENTIFIER,
      sessionId: this.sessionId,
    };
    return [this.makeEvent('stream_start', data)];
  }

  private closeStream(): HeterogeneousAgentEvent[] {
    this.pendingStream = false;
    if (!this.streamOpen) return [];
    this.streamOpen = false;
    return [this.makeEvent('stream_end', {})];
  }

  private handleChunk(chunk: any, subagent?: SubagentEventContext): HeterogeneousAgentEvent[] {
    if (!chunk || typeof chunk.type !== 'string') return [];

    switch (chunk.type) {
      case 'block-end': {
        // Tool-call arguments are only complete once the block closes; the
        // per-delta fragments carry no independently useful state.
        const block = chunk.block;
        if (block?.type !== 'tool-call') return [];
        const payload = this.registerToolCall(block.id, block.name, block.arguments);
        return [
          ...this.openStreamIfPending(),
          this.makeChunk({ chunkType: 'tools_calling', toolsCalling: [payload] }, subagent),
        ];
      }
      // A terminal `finish` is NOT a terminal run failure: `dsh-llm-retry` can
      // recover the attempt and the turn continues. `turn/end` owns the verdict.
      case 'finish': {
        return [];
      }
      case 'reasoning-delta': {
        if (!chunk.text) return [];
        return [
          ...this.openStreamIfPending(),
          this.makeChunk({ chunkType: 'reasoning', reasoning: chunk.text }, subagent),
        ];
      }
      case 'text-delta': {
        if (!chunk.text) return [];
        return [
          ...this.openStreamIfPending(),
          this.makeChunk({ chunkType: 'text', content: chunk.text }, subagent),
        ];
      }
      // `usage` rides on the `assistant/message` that follows a successful call;
      // `block-start` and the delta fragments of an assembled block add nothing.
      default: {
        return [];
      }
    }
  }

  /**
   * The harness records three title sources. `fallback` is a deterministic
   * truncation of the first user message, which is worse than the consumer's
   * own summarization — forwarding it would downgrade the title, so only a
   * provider-generated or user-set title crosses.
   */
  private handleTitle(data: any): HeterogeneousAgentEvent[] {
    const kind = data?.source?.kind;
    if (typeof data?.title !== 'string' || !data.title) return [];
    if (kind !== 'provider' && kind !== 'user') return [];

    const payload: SessionTitleData = {
      origin: kind === 'user' ? 'user' : 'model',
      title: data.title,
    };
    return [this.makeEvent('session_title', payload)];
  }

  private handleAssistantMessage(
    data: any,
    subagent?: SubagentEventContext,
  ): HeterogeneousAgentEvent[] {
    if (subagent) return [];

    // A content-less step (a `max-tokens` cut-off still records its usage)
    // produces no chunk, so the stream may still be pending here.
    const events: HeterogeneousAgentEvent[] = [
      ...this.openStreamIfPending(),
      ...this.closeStream(),
    ];

    const usage = toUsageData(data?.usage);
    const stepComplete: StepCompleteData = {
      model: this.route?.model,
      phase: 'turn_metadata',
      // The hetero contract keys pricing on the wrapping runtime, not the
      // wrapped model's vendor.
      provider: DSH_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };
    events.push(this.makeEvent('step_complete', stepComplete));
    return events;
  }

  private handleToolCall(
    sessionId: string,
    data: any,
    subagent?: SubagentEventContext,
  ): HeterogeneousAgentEvent[] {
    if (!data?.callId) return [];

    this.lastToolCallBySession.set(sessionId, data.callId);
    const toolCalling = this.registerToolCall(data.callId, data.name, data.arguments);

    const startData: Record<string, unknown> = { toolCalling };
    if (subagent) startData.subagent = subagent;
    return [...this.openStreamIfPending(), this.makeEvent('tool_start', startData)];
  }

  private handleToolResult(data: any, subagent?: SubagentEventContext): HeterogeneousAgentEvent[] {
    const block = data?.message?.content?.[0];
    const toolCallId = block?.toolCallId ?? data?.callId;
    if (!toolCallId) return [];

    const isError = Boolean(block?.isError ?? data?.error);
    const content = flattenBlocks(block?.content);

    const resultData: ToolResultData = { content, toolCallId, ...(isError ? { isError } : {}) };
    if (subagent) resultData.subagent = subagent;

    const endData: Record<string, unknown> = { isSuccess: !isError, toolCallId };
    const toolCalling = this.toolPayloadById.get(toolCallId);
    if (toolCalling) endData.payload = { toolCalling };
    endData.result = { content, success: !isError };
    if (subagent) endData.subagent = subagent;

    return [this.makeEvent('tool_result', resultData), this.makeEvent('tool_end', endData)];
  }

  private handleTurnEnd(data: any, subagent?: SubagentEventContext): HeterogeneousAgentEvent[] {
    if (subagent) return [];

    const events: HeterogeneousAgentEvent[] = [];
    if (data?.reason?.kind === 'error') {
      // A request that failed before producing output still needs an assistant
      // message for the error card to land on.
      events.push(...this.openStreamIfPending());
      events.push(...this.terminalError(data.reason.error, 'error'));
    }
    events.push(...this.closeStream(), this.makeEvent('visible_output_end', {}));
    return events;
  }

  /**
   * The runtime reports whole-agent idle, which is the only signal that the
   * prompt's work — including any continuation the loop scheduled itself — is
   * done. The session layer stops reading here.
   */
  private handleStatus(params: any): HeterogeneousAgentEvent[] {
    if (params?.sessionId !== this.sessionId || params?.status !== 'idle') return [];
    if (this.finished) return [];
    this.finished = true;
    return [this.makeEvent('agent_runtime_end', {})];
  }

  /**
   * `subagent.started` names the parent and child sessions but not the tool
   * call that delegated, so the link is the parent's most recent dispatched
   * call. That holds while the harness dispatches delegation calls
   * exclusively; a parallel batch containing two delegations would mislink.
   * Correlating exactly needs `parentToolCallId` on the notification.
   */
  private linkSubagent(params: any): void {
    const { childSessionId, parentSessionId } = params ?? {};
    if (typeof childSessionId !== 'string' || typeof parentSessionId !== 'string') return;

    const parentToolCallId = this.lastToolCallBySession.get(parentSessionId);
    if (!parentToolCallId) return;

    const spawningCall = this.toolPayloadById.get(parentToolCallId);
    this.subagentByChildSession.set(childSessionId, {
      parentToolCallId,
      pendingSpawn: true,
      spawnMetadata: {
        // Provisional title from the delegating call; a `subagent/descriptor`
        // on the child replaces it with the harness-side label when one lands.
        description: spawningCall?.apiName,
        prompt: extractPrompt(spawningCall?.arguments),
      },
    });
  }

  private subagentContextFor(sessionId: string): SubagentEventContext | undefined {
    const link = this.subagentByChildSession.get(sessionId);
    if (!link) return undefined;
    return { parentToolCallId: link.parentToolCallId };
  }

  private attachSpawnMetadata(sessionId: string, event: HeterogeneousAgentEvent): void {
    const link = this.subagentByChildSession.get(sessionId);
    if (!link?.pendingSpawn) return;

    link.pendingSpawn = false;
    if (!link.spawnMetadata) return;

    const subagent = (event.data as { subagent?: SubagentEventContext }).subagent;
    if (subagent) subagent.spawnMetadata = link.spawnMetadata;
  }

  private registerToolCall(id: string, name: string, args: unknown): ToolCallPayload {
    const existing = this.toolPayloadById.get(id);
    if (existing) return existing;

    const payload: ToolCallPayload = {
      apiName: name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      id,
      identifier: name,
      type: 'default',
    };
    this.toolPayloadById.set(id, payload);
    return payload;
  }

  private terminalError(failure: any, kind: string): HeterogeneousAgentEvent[] {
    if (this.terminalErrorEmitted) return [];
    this.terminalErrorEmitted = true;

    const data: HeterogeneousTerminalErrorData = {
      agentType: DSH_IDENTIFIER,
      code: failure?.code,
      details: { finishKind: kind, ...(failure?.status ? { status: failure.status } : {}) },
      message: failure?.message ?? 'DeepSeek Harness execution failed',
    };
    return [this.makeEvent('error', data)];
  }

  private makeChunk(
    data: StreamChunkData,
    subagent?: SubagentEventContext,
  ): HeterogeneousAgentEvent {
    return this.makeEvent('stream_chunk', subagent ? { ...data, subagent } : data);
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }
}
