import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import pc from 'picocolors';

import type { AgentRunOutcome } from './agentRunOutcome';
import { classifyRunStatus, describeOutcome } from './agentRunOutcome';
import type { AgentHistoryPage } from './agentStreamTransport';
import { AgentStreamHistoryError, consumeAgentStream } from './agentStreamTransport';
import { log } from './logger';

export type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

interface StreamOptions {
  json?: boolean;
  verbose?: boolean;
}

interface LiveStreamOptions extends StreamOptions {
  /**
   * Called when the stream has carried no progress for `stallTimeoutMs`. A
   * gateway can keep a connection alive with heartbeats while never
   * delivering the terminal event, so silence alone
   * must not be read as either "finished" or "failed". Return the run's
   * outcome to finish, `undefined` when the run is still active (keep
   * streaming), or throw to give up on the stream.
   */
  onStall?: () => Promise<AgentRunOutcome | undefined>;
  /** Progress window before `onStall` is consulted. Defaults to 60s. */
  stallTimeoutMs?: number;
}

interface WebSocketStreamOptions extends LiveStreamOptions {
  gatewayUrl: string;
  getAuth?: () => Promise<{ serverUrl: string; token: string; tokenType: 'jwt' | 'apiKey' }>;
  maxRetries?: number;
  operationId: string;
  readHistory?: (cursor: string, signal: AbortSignal) => Promise<AgentHistoryPage>;
  /**
   * LobeHub server URL the gateway should call back to when verifying
   * an apiKey token (via `/api/v1/users/me`). Required when
   * `tokenType === 'apiKey'`; ignored for JWT.
   */
  serverUrl?: string;
  token: string;
  /**
   * How the gateway should verify `token`. `jwt` is the default for
   * backwards compatibility with existing callers.
   */
  tokenType?: 'jwt' | 'apiKey';
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
 * Connect to the Agent Gateway via WebSocket and render events to the terminal.
 * Resolves with the run outcome once a terminal event arrives, `undefined` when
 * the gateway completed the session without one, and rejects when the
 * connection fails so the caller can fall back to polling.
 */
export async function streamAgentEventsViaWebSocket(
  options: WebSocketStreamOptions,
): Promise<AgentRunOutcome | undefined> {
  const jsonEvents: AgentStreamEvent[] = [];
  const ctx = createRenderContext();
  let outcome: AgentRunOutcome | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let rejectStall: (error: Error) => void;
  let resolveStall: () => void;
  const stalled = new Promise<void>((resolve, reject) => {
    resolveStall = resolve;
    rejectStall = reject;
  });
  const armStallTimer = () => {
    if (!options.onStall && options.readHistory) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(async () => {
      try {
        if (!options.onStall) {
          rejectStall(
            new Error('Agent gateway WebSocket sent no progress and never reported completion'),
          );
          return;
        }
        const result = await options.onStall!();
        if (finished) return;
        if (!result) {
          armStallTimer();
          return;
        }
        if (options.readHistory) {
          rejectStall(
            new AgentStreamHistoryError(
              'Run status is terminal but the complete event history has no terminal event',
            ),
          );
          return;
        }
        outcome = result;
        if (!options.json) renderOutcome(result);
        resolveStall();
      } catch (error) {
        if (!finished) {
          const failure = error instanceof Error ? error : new Error(String(error));
          rejectStall(options.readHistory ? new AgentStreamHistoryError(failure.message) : failure);
        }
      }
    }, options.stallTimeoutMs ?? STALL_TIMEOUT);
  };
  const transport = consumeAgentStream(
    options,
    (event) => {
      armStallTimer();
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
    () => {},
  );
  armStallTimer();
  try {
    await Promise.race([transport.done, stalled]);
    return outcome;
  } finally {
    finished = true;
    clearTimeout(stallTimer);
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

function renderOutcome(outcome: AgentRunOutcome): void {
  console.log();
  console.log(describeOutcome(outcome));
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
