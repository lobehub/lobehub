import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import pc from 'picocolors';

import type { AgentRunOutcome } from './agentRunOutcome';
import { classifyRunStatus, describeOutcome } from './agentRunOutcome';
import type { AgentStreamTransportOptions } from './agentStreamTransport';
import { AgentStreamHistoryError, consumeAgentStream } from './agentStreamTransport';
import { log } from './logger';

export type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

interface StreamOptions {
  json?: boolean;
  verbose?: boolean;
}

interface FollowStreamOptions extends StreamOptions, AgentStreamTransportOptions {
  /**
   * Called when the stream has carried no progress for `stallTimeoutMs`. A
   * gateway can keep a connection alive with heartbeats while never
   * delivering the terminal event, so silence alone must not be read as either
   * "finished" or "failed". Return `undefined` while the run is still active
   * (keep streaming). A terminal outcome gets a bounded final catch-up for the
   * terminal journal event first, then the stream fails as incomplete; throwing
   * does too.
   */
  onStall?: () => Promise<AgentRunOutcome | undefined>;
  /** Progress window before `onStall` is consulted. Defaults to 60s. */
  stallTimeoutMs?: number;
}

/**
 * Map an `agent_runtime_end` event to the run outcome. The server ends the
 * stream on `done`, `error`, `interrupted` and `waiting_for_human` alike, so the
 * end event alone does not mean the run succeeded — `data.reason` says how.
 */
export const outcomeFromEndEvent = (event: AgentStreamEvent): AgentRunOutcome => {
  const reason: string | undefined = event.data?.reason;
  const kind = classifyRunStatus(reason);
  const error = event.data?.finalState?.error;
  return {
    error: typeof error === 'string' ? error : (error?.message ?? undefined),
    // An end event without a reason predates `reason` and has always meant done.
    kind: !reason ? 'completed' : kind && kind !== 'active' ? kind : 'unknown',
    status: reason,
  };
};

const STALL_TIMEOUT = 60_000;

const outcomeFromErrorEvent = (event: AgentStreamEvent): AgentRunOutcome => ({
  error: event.data?.message || event.data?.error || 'Unknown error',
  kind: 'failed',
  status: 'error',
});

/**
 * Replay previously saved JSON events (from --json output) to the terminal.
 * No network calls needed. Returns the outcome carried by the recorded terminal
 * event, or `undefined` when the recording has none (e.g. a truncated capture).
 */
export function replayAgentEvents(
  events: AgentStreamEvent[],
  options: StreamOptions = {},
): AgentRunOutcome | undefined {
  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    for (const event of events) {
      if (event.type === 'agent_runtime_end') return outcomeFromEndEvent(event);
      if (event.type === 'error') return outcomeFromErrorEvent(event);
    }
    return undefined;
  }

  const ctx = createRenderContext();

  for (const event of events) {
    if (!event.type) continue;

    renderEvent(event, ctx, options);

    if (event.type === 'agent_runtime_end') {
      const outcome = outcomeFromEndEvent(event);
      renderEnd(event, outcome);
      return outcome;
    }

    if (event.type === 'error') {
      const outcome = outcomeFromErrorEvent(event);
      log.error(`Agent error: ${outcome.error}`);
      return outcome;
    }
  }

  return undefined;
}

/**
 * Consult `onStall` whenever `timeoutMs` passes without progress. Re-arms while
 * the run is still active; a terminal status means the journal should hold the
 * terminal event too, so `onFinalCatchUp` gets a bounded grace to read it before
 * the history is declared incomplete. (The coordinator persists the terminal
 * state *before* publishing it, so a status probe can win that race — and with
 * it the simultaneous periodic catch-up.)
 */
const TERMINAL_HISTORY_GRACE_ATTEMPTS = 3;
const TERMINAL_HISTORY_GRACE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const watchForStall = (
  timeoutMs: number,
  onStall: () => Promise<AgentRunOutcome | undefined>,
  onIncomplete: (error: AgentStreamHistoryError) => void,
  onFinalCatchUp?: () => Promise<boolean>,
) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let message = 'Run status is terminal but the complete event history has no terminal event';
      try {
        if (!(await onStall())) return arm();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // A terminal status does not guarantee the terminal journal event already
      // landed; read once more, then retry over a short bounded window.
      if (onFinalCatchUp) {
        const readTerminal = onFinalCatchUp;
        for (let attempt = 0; attempt < TERMINAL_HISTORY_GRACE_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await sleep(TERMINAL_HISTORY_GRACE_DELAY_MS);
            if (stopped) return;
          }
          if (await readTerminal()) return;
          if (stopped) return;
        }
      }
      if (!stopped) onIncomplete(new AgentStreamHistoryError(message));
    }, timeoutMs);
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  arm();
  return { arm, stop };
};

/**
 * Follow an operation's events (server journal, woken by the Gateway
 * WebSocket) and render them to the terminal. Resolves with the outcome of the
 * terminal event; rejects with `AgentStreamHistoryError` when the complete
 * event history cannot be confirmed.
 */
export async function streamAgentEvents(
  options: FollowStreamOptions,
): Promise<AgentRunOutcome | undefined> {
  const jsonEvents: AgentStreamEvent[] = [];
  const ctx = createRenderContext();
  let outcome: AgentRunOutcome | undefined;

  const transport = consumeAgentStream(
    {
      ...options,
      // A group member's events ride the supervisor's socket but never its
      // journal, so they are rendered from the wire. They are never terminal:
      // the supervisor continues after a member finishes.
      onMirroredEvent: (event) => {
        stall?.arm();
        if (options.json) jsonEvents.push(event);
        else renderEvent(event, ctx, options);
      },
    },
    (event) => {
      stall?.arm();
      if (options.json) jsonEvents.push(event);
      else renderEvent(event, ctx, options);
      if (event.type === 'agent_runtime_end') {
        outcome = outcomeFromEndEvent(event);
        if (!options.json) renderEnd(event, outcome);
        return true;
      }
      if (event.type === 'error') {
        outcome = outcomeFromErrorEvent(event);
        log.error(`Agent error: ${outcome.error}`);
        return true;
      }
      return false;
    },
  );
  const stall =
    options.onStall &&
    watchForStall(
      options.stallTimeoutMs ?? STALL_TIMEOUT,
      options.onStall,
      transport.abort,
      transport.catchUp,
    );

  try {
    await transport.done;
    return outcome;
  } finally {
    stall?.stop();
    transport.close();
    if (options.json) console.log(JSON.stringify(jsonEvents, null, 2));
  }
}

// ── Render helpers ──────────────────────────────────────

interface RenderContext {
  /** Tool call IDs already printed from streaming tools_calling chunks */
  printedToolCalls: Set<string>;
}

function createRenderContext(): RenderContext {
  return { printedToolCalls: new Set() };
}

function renderEvent(event: AgentStreamEvent, ctx: RenderContext, options: StreamOptions): void {
  switch (event.type) {
    case 'agent_runtime_init': {
      log.info('Agent started');
      break;
    }

    case 'step_start': {
      if (event.stepIndex > 0) console.log();
      console.log(pc.bold(pc.cyan(`── Step ${event.stepIndex + 1} ──`)));
      break;
    }

    case 'stream_start': {
      // Quiet, content will follow
      break;
    }

    case 'stream_chunk': {
      const data = event.data;
      if (!data) break;

      if (data.chunkType === 'text' && data.content) {
        process.stdout.write(data.content);
      } else if (data.chunkType === 'reasoning' && data.reasoning) {
        process.stdout.write(pc.dim(data.reasoning));
      } else if (data.chunkType === 'tools_calling' && data.toolsCalling) {
        // tools_calling chunks arrive incrementally with the same tool ID.
        // Only print each tool call once (on first appearance).
        for (const tool of data.toolsCalling) {
          const id = tool.id || '';
          if (id && ctx.printedToolCalls.has(id)) continue;
          if (id) ctx.printedToolCalls.add(id);
          const name = tool.apiName || tool.function?.name || 'unknown';
          log.toolCall(name, id);
        }
      }
      break;
    }

    case 'stream_end': {
      process.stdout.write('\n');
      // Reset dedup set for next step's tool calls
      ctx.printedToolCalls.clear();
      break;
    }

    case 'tool_start': {
      const tc = event.data?.toolCalling || event.data;
      const name = tc?.apiName || tc?.name || 'tool';
      const id = tc?.id || event.data?.requestId || '';
      log.toolCall(
        name,
        id,
        options.verbose ? tc?.arguments || JSON.stringify(tc?.args) : undefined,
      );
      break;
    }

    case 'tool_end': {
      const payload = event.data?.payload || event.data;
      const tc = payload?.toolCalling || payload;
      const id = tc?.id || event.data?.requestId || '';
      const success = event.data?.isSuccess !== false;
      const time = event.data?.executionTime;
      const timeSuffix = time ? ` ${time}ms` : '';
      // Some transports drop the result body before it reaches us (the gateway
      // WS projects `tool_end` for tools whose body no consumer reads — it
      // arrives with the message instead). Fall back to the timing so
      // `--verbose` never prints `undefined`.
      const body = options.verbose ? event.data?.result?.content : undefined;
      log.toolResult(id, success, body ?? timeSuffix);
      break;
    }

    case 'step_complete': {
      // Step finished, next step_start or agent_runtime_end will follow
      break;
    }
  }
}

function renderEnd(event: AgentStreamEvent, outcome: AgentRunOutcome): void {
  console.log();
  const data = { ...event.data?.finalState, ...event.data };
  const parts: string[] = [describeOutcome(outcome)];

  if (data.stepCount !== undefined) {
    parts.push(`${data.stepCount} step${data.stepCount !== 1 ? 's' : ''}`);
  }
  if (data.usage?.total_tokens) {
    parts.push(`${data.usage.total_tokens} tokens`);
  }
  if (data.cost?.total !== undefined) {
    parts.push(`$${data.cost.total.toFixed(4)}`);
  }

  console.log(parts.join(pc.dim(' · ')));
}
