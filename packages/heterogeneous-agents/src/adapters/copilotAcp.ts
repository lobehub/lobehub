import { isRecord } from '@lobechat/utils/object';

import type {
  HeterogeneousAgentEvent,
  StreamChunkData,
  SubagentEventContext,
  SubagentSpawnMetadata,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';
import { acpContentBlockText } from './acpCommon';
import { TraeAcpAdapter, type TraeAcpPayload } from './traeAcp';

const PROVIDER = 'copilot';
const META_KEY = 'github.com/copilot';
/** Whole-chunk progress notice Copilot streams while it retries a failed model request. */
const RETRY_NOTICE = /^Info: .+ Retrying\.\.\.$/;
/** Copilot reports a provider failure as one `Error: …` message chunk, then ends the turn. */
const ERROR_NOTICE_PREFIX = 'Error: ';
/**
 * BYOK notice Copilot streams as reply text on every turn whose model is not in
 * its catalog, which includes every LobeHub server-default `lobehub/…` model.
 */
const TOKEN_ESTIMATE_NOTICE =
  /^Warning: No token count multiplier is known for .+ model ".+"\. Token estimates will use the 1\.0 fallback;/;
const CANCELLED_TOOL_RESULT = 'Cancelled before the tool finished.';
/** Updates that interleave with a message without ending it. */
const SIDE_CHANNEL_UPDATES = new Set([
  'available_commands_update',
  'config_option_update',
  'current_mode_update',
  'session_info_update',
  'usage_update',
]);

interface SubagentRun {
  agentIds: Set<string>;
  parentToolCallId: string;
  spawnMetadata?: SubagentSpawnMetadata;
  /** The subagent's tool calls in its current model round. */
  tools: ToolCallPayload[];
  turn: number;
  /** A tool of this round returned, so the next chunk opens a new round. */
  turnSettled: boolean;
}

const textOf = (raw: TraeAcpPayload): string | undefined => {
  const text = (raw.content as { text?: unknown } | null)?.text;
  return typeof text === 'string' && text ? text : undefined;
};

const agentIdOf = (raw: TraeAcpPayload): string | undefined => {
  const meta = isRecord(raw._meta) ? raw._meta[META_KEY] : undefined;
  return isRecord(meta) && typeof meta.agentId === 'string' ? meta.agentId : undefined;
};

/** The `task` tool spawns a subagent; its rawInput names the agent template. */
const spawnMetadataOf = (raw: TraeAcpPayload): SubagentSpawnMetadata | undefined => {
  const input = isRecord(raw.rawInput) ? raw.rawInput : undefined;
  if (raw.kind !== 'other' || typeof input?.agent_type !== 'string') return;
  return {
    description: typeof input.description === 'string' ? input.description : undefined,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    subagentType: input.agent_type,
  };
};

const isTerminal = (raw: TraeAcpPayload) => raw.status === 'completed' || raw.status === 'failed';

/**
 * Copilot puts a file read's result only in `rawOutput.content` and a
 * rejection only in `rawOutput.message`; shell results also carry `content`.
 */
const toolResultText = (raw: TraeAcpPayload): string | undefined => {
  if (Array.isArray(raw.content)) {
    const text = raw.content.map(acpContentBlockText).filter(Boolean).join('\n');
    if (text) return text;
  }
  const output = isRecord(raw.rawOutput) ? raw.rawOutput : undefined;
  if (typeof output?.content === 'string') return output.content;
  if (typeof output?.message === 'string') return output.message;
};

/**
 * Maps GitHub Copilot's ACP session updates onto the shared event contract.
 * Copilot speaks standard ACP; this covers what it leaves implicit:
 *
 * - Subagent (`task` tool) text, thoughts and usage carry no marker and arrive
 *   between the task's `tool_call` and its terminal update; only the
 *   subagent's own tool calls carry `_meta["github.com/copilot"].agentId`.
 *   All of it is stamped with the task as `subagent` so it stays in the
 *   thread instead of the main bubble.
 * - A cancelled turn sends no terminal update for a running or
 *   permission-blocked tool, so those tools get a cancelled result here.
 * - Provider failures and retries arrive as plain message chunks
 *   (`Info: … Retrying...`, `Error: …`) on a turn that still ends `end_turn`.
 */
export class CopilotAcpAdapter extends TraeAcpAdapter {
  private ended = false;
  private heldErrorNotice?: string;
  private messageOpen = false;
  private readonly mainPendingTools = new Set<string>();
  private retryAttempt = 0;
  /** Running subagents, oldest first. */
  private runs: SubagentRun[] = [];
  private readonly subagentPendingTools = new Map<string, SubagentRun>();

  constructor() {
    super({ eventPrefix: PROVIDER, provider: PROVIDER });
  }

  override adapt(value: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(value) || this.ended) return [];
    const raw = value as TraeAcpPayload;

    if (raw.type === `${PROVIDER}_prompt_completed`) return this.completeTurn(raw);
    if (raw.type === `${PROVIDER}_error`) {
      return this.end([...this.releaseHeld(), ...this.main(raw)]);
    }
    if (typeof raw.sessionUpdate !== 'string') return this.main(raw);

    const subagentEvents = this.routeSubagent(raw);
    if (subagentEvents) return subagentEvents;

    if (raw.sessionUpdate === 'agent_message_chunk') return this.messageChunk(raw);
    if (SIDE_CHANNEL_UPDATES.has(raw.sessionUpdate)) return this.main(raw);

    this.messageOpen = false;
    const events = [...this.releaseHeld(), ...this.main(raw)];
    const spawnMetadata = raw.sessionUpdate === 'tool_call' ? spawnMetadataOf(raw) : undefined;
    if (spawnMetadata && typeof raw.toolCallId === 'string') {
      this.runs.push({
        agentIds: new Set(),
        parentToolCallId: raw.toolCallId,
        spawnMetadata,
        tools: [],
        turn: 1,
        turnSettled: false,
      });
    }
    if (raw.sessionUpdate === 'tool_call_update' && isTerminal(raw)) {
      this.runs = this.runs.filter(({ parentToolCallId }) => parentToolCallId !== raw.toolCallId);
    }
    return events;
  }

  override flush(): HeterogeneousAgentEvent[] {
    if (this.ended) return [];
    return this.end([...this.releaseHeld(), ...super.flush()]);
  }

  /**
   * Copilot's `inputTokens` already count cache reads and writes
   * (`inputTokens + outputTokens === totalTokens`); the standard mapping adds
   * `cachedWriteTokens` on top of them.
   */
  protected override toUsageData(usage: unknown): UsageData | undefined {
    const data = super.toUsageData(usage);
    const written = data?.inputWriteCacheTokens ?? 0;
    if (!data || !written) return data;
    return {
      ...data,
      inputCacheMissTokens: Math.max(0, data.inputCacheMissTokens - written),
      totalInputTokens: data.totalInputTokens - written,
    };
  }

  private completeTurn(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    // A turn that streamed only a failure notice and never reported usage
    // ended on a provider error, not on an answer.
    if (this.heldErrorNotice && raw.stopReason === 'end_turn' && raw.usage === undefined) {
      const message = this.heldErrorNotice.slice(ERROR_NOTICE_PREFIX.length).trim();
      this.heldErrorNotice = undefined;
      return this.end(this.main({ message, type: `${PROVIDER}_error` }));
    }
    const events = this.releaseHeld();
    if (raw.stopReason === 'cancelled') events.push(...this.cancelPendingTools());
    return this.end([...events, ...this.main(raw)]);
  }

  private messageChunk(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    const text = textOf(raw);
    if (!text) return [];
    if (!this.messageOpen && TOKEN_ESTIMATE_NOTICE.test(text)) return [];
    if (RETRY_NOTICE.test(text)) {
      this.messageOpen = false;
      this.retryAttempt += 1;
      return [
        ...this.releaseHeld(),
        this.stream.event('stream_retry', {
          agentType: PROVIDER,
          attempt: this.retryAttempt,
          error: text,
          provider: PROVIDER,
        }),
      ];
    }
    // Hold a message that opens with `Error: ` until the turn shows whether
    // it is Copilot's failure notice or the start of an ordinary answer.
    if (!this.messageOpen && text.startsWith(ERROR_NOTICE_PREFIX)) {
      this.messageOpen = true;
      this.heldErrorNotice = text;
      return [];
    }
    this.messageOpen = true;
    return [...this.releaseHeld(), ...this.main(raw)];
  }

  private releaseHeld(): HeterogeneousAgentEvent[] {
    const text = this.heldErrorNotice;
    if (!text) return [];
    this.heldErrorNotice = undefined;
    return this.main({ content: { text, type: 'text' }, sessionUpdate: 'agent_message_chunk' });
  }

  /** Forward to the standard ACP mapping, tracking which main tools are still open. */
  private main(raw: TraeAcpPayload): HeterogeneousAgentEvent[] {
    const events = super.adapt(raw);
    for (const event of events) {
      const { toolCallId } = event.data as { toolCallId?: string };
      if (event.type === 'tool_start' && toolCallId) this.mainPendingTools.add(toolCallId);
      if (event.type === 'tool_end' && toolCallId) this.mainPendingTools.delete(toolCallId);
      if (event.type === 'tool_result' && toolCallId === raw.toolCallId && raw.content == null) {
        const text = toolResultText(raw);
        if (text !== undefined) (event.data as ToolResultData).content = text;
      }
    }
    return events;
  }

  private end(events: HeterogeneousAgentEvent[]): HeterogeneousAgentEvent[] {
    this.ended = true;
    return events;
  }

  private routeSubagent(raw: TraeAcpPayload): HeterogeneousAgentEvent[] | undefined {
    const toolCallId = typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined;
    if (raw.sessionUpdate === 'tool_call' || raw.sessionUpdate === 'tool_call_update') {
      if (!toolCallId) return;
      const owner = this.subagentPendingTools.get(toolCallId);
      if (owner) return this.subagentToolUpdate(raw, toolCallId, owner);
      const agentId = agentIdOf(raw);
      const run = agentId ? this.runFor(agentId) : undefined;
      return run ? this.subagentToolStart(raw, toolCallId, run) : undefined;
    }

    const run = this.runs.at(-1);
    if (!run) return;
    if (raw.sessionUpdate === 'usage_update' || raw.sessionUpdate === 'plan') return [];
    if (
      raw.sessionUpdate !== 'agent_message_chunk' &&
      raw.sessionUpdate !== 'agent_thought_chunk'
    ) {
      return;
    }
    const text = textOf(raw);
    if (!text) return [];
    if (run.turnSettled) this.advanceTurn(run);
    return [
      this.stream.event('stream_chunk', {
        ...(raw.sessionUpdate === 'agent_message_chunk'
          ? { chunkType: 'text', content: text }
          : { chunkType: 'reasoning', reasoning: text }),
        subagent: this.subagentContext(run),
      } satisfies StreamChunkData),
    ];
  }

  /** Bind a subagent's tool calls to the earliest running task it can belong to. */
  private runFor(agentId: string): SubagentRun | undefined {
    const run =
      this.runs.find(({ agentIds }) => agentIds.has(agentId)) ??
      this.runs.find(({ agentIds }) => agentIds.size === 0) ??
      this.runs.at(-1);
    run?.agentIds.add(agentId);
    return run;
  }

  private subagentToolStart(
    raw: TraeAcpPayload,
    toolCallId: string,
    run: SubagentRun,
  ): HeterogeneousAgentEvent[] {
    if (run.turnSettled) this.advanceTurn(run);
    const payload: ToolCallPayload = {
      apiName:
        [raw.title, raw.kind].find(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ) ?? 'unknown',
      arguments: JSON.stringify(raw.rawInput ?? {}),
      id: toolCallId,
      identifier: PROVIDER,
      type: 'default',
    };
    run.tools.push(payload);
    this.subagentPendingTools.set(toolCallId, run);
    const subagent = this.subagentContext(run);
    const events = [
      this.stream.event('stream_chunk', {
        chunkType: 'tools_calling',
        subagent,
        toolsCalling: [...run.tools],
      } satisfies StreamChunkData),
      this.stream.event('tool_start', { subagent, toolCalling: payload, toolCallId }),
    ];
    return [...events, ...this.subagentToolUpdate(raw, toolCallId, run)];
  }

  private subagentToolUpdate(
    raw: TraeAcpPayload,
    toolCallId: string,
    run: SubagentRun,
  ): HeterogeneousAgentEvent[] {
    if (!isTerminal(raw)) return [];
    const isSuccess = raw.status === 'completed';
    const subagent = { parentToolCallId: run.parentToolCallId };
    this.subagentPendingTools.delete(toolCallId);
    run.turnSettled = true;
    return [
      this.stream.event('tool_result', {
        content: toolResultText(raw) ?? '',
        isError: !isSuccess,
        subagent,
        toolCallId,
      } satisfies ToolResultData),
      this.stream.event('tool_end', { isSuccess, subagent, toolCallId }),
    ];
  }

  private advanceTurn(run: SubagentRun): void {
    run.turn += 1;
    run.tools = [];
    run.turnSettled = false;
  }

  /** Spawn metadata rides only on the first event of a run. */
  private subagentContext(run: SubagentRun): SubagentEventContext {
    const context: SubagentEventContext = {
      parentToolCallId: run.parentToolCallId,
      ...(run.spawnMetadata ? { spawnMetadata: run.spawnMetadata } : {}),
      subagentMessageId: `${PROVIDER}:${run.parentToolCallId}:${run.turn}`,
    };
    run.spawnMetadata = undefined;
    return context;
  }

  private cancelPendingTools(): HeterogeneousAgentEvent[] {
    const cancelled = (toolCallId: string, subagent?: SubagentEventContext) =>
      this.stream.event('tool_result', {
        content: CANCELLED_TOOL_RESULT,
        isError: true,
        ...(subagent ? { subagent } : {}),
        toolCallId,
      } satisfies ToolResultData);

    const events: HeterogeneousAgentEvent[] = [];
    for (const [toolCallId, run] of this.subagentPendingTools) {
      const subagent = { parentToolCallId: run.parentToolCallId };
      events.push(
        cancelled(toolCallId, subagent),
        this.stream.event('tool_end', { isSuccess: false, subagent, toolCallId }),
      );
    }
    this.subagentPendingTools.clear();
    // The base adapter ends these tools unsuccessfully once the turn closes.
    for (const toolCallId of this.mainPendingTools) events.push(cancelled(toolCallId));
    return events;
  }
}
