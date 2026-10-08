import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import pc from 'picocolors';
import urlJoin from 'url-join';

import type { AgentRunOutcome } from './agentRunOutcome';
import { classifyRunStatus, describeOutcome } from './agentRunOutcome';
import { log } from './logger';

export type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

interface StreamOptions {
  json?: boolean;
  verbose?: boolean;
}

interface LiveStreamOptions extends StreamOptions {
  /**
   * Called when the stream has carried no progress for `stallTimeoutMs`. Both
   * transports can keep a connection alive with heartbeats while never
   * delivering the terminal event (a gateway that does not forward it, or an
   * SSE subscription opened after a fast run already ended), so silence alone
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
  operationId: string;
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
 * Connect to the agent SSE stream and render events to the terminal.
 * Resolves with the run outcome once a terminal event arrives, or `undefined`
 * when the stream closed without one (the caller should check the status).
 * Rejects when the stream cannot be opened — the run may still be executing
 * server-side, so the caller falls back to polling rather than exiting here.
 */
export async function streamAgentEvents(
  url: string,
  headers: Record<string, string>,
  options: LiveStreamOptions = {},
): Promise<AgentRunOutcome | undefined> {
  const { onStall, stallTimeoutMs = STALL_TIMEOUT } = options;
  const jsonEvents: AgentStreamEvent[] = [];
  // `--json` promises one JSON array on stdout whatever happens next — even
  // `[]` when the stream fails before any event and the caller falls back to
  // polling — so every exit path prints through here exactly once.
  let jsonPrinted = false;
  const printJsonOnce = () => {
    if (!options.json || jsonPrinted) return;
    jsonPrinted = true;
    console.log(JSON.stringify(jsonEvents, null, 2));
  };

  let res: Response;
  try {
    res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Agent stream failed: ${res.status} ${text}`);
    }
    if (!res.body) {
      throw new Error('No response body received from agent stream');
    }
  } catch (error) {
    printJsonOnce();
    throw error;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const ctx = createRenderContext();

  // Declared outside the read loop so partial SSE frames that span
  // chunk boundaries are not lost between reader.read() calls.
  let eventType = '';
  let eventData = '';

  // Progress window, restarted by real events only — SSE heartbeats keep the
  // response open even when the terminal event was missed, so they must not
  // count. When it expires, `onStall` decides; its verdict is handed back to
  // the read loop by cancelling the pending read. Without `onStall` there is no
  // window at all: silence is not evidence, and a quiet tool call is legitimate.
  let finished = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let stalled: { error: Error } | { outcome: AgentRunOutcome } | undefined;
  const armStallTimer = () => {
    if (!onStall) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(async () => {
      if (finished) return;
      const silence = `Agent stream sent no progress for ${Math.round(stallTimeoutMs / 1000)}s`;
      log.debug(`${silence}; checking the run status`);
      try {
        const outcome = await onStall();
        if (finished) return;
        if (!outcome) {
          armStallTimer();
          return;
        }
        stalled = { outcome };
      } catch (error) {
        if (finished) return;
        stalled = {
          error: new Error(`${silence}; status check failed: ${(error as Error).message}`),
        };
      }
      void reader.cancel();
    }, stallTimeoutMs);
  };
  armStallTimer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (stalled) {
        finished = true;
        if ('error' in stalled) {
          printJsonOnce();
          throw stalled.error;
        }
        if (options.json) printJsonOnce();
        else renderOutcome(stalled.outcome);
        return stalled.outcome;
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
          continue;
        }

        if (line.startsWith('data:')) {
          eventData = line.slice(5).trim();
        }

        // Empty line = end of SSE message
        if (line === '' && eventData) {
          if (eventType === 'heartbeat') {
            log.heartbeat();
            eventType = '';
            eventData = '';
            continue;
          }

          armStallTimer();
          try {
            const event: AgentStreamEvent = JSON.parse(eventData);

            if (options.json) {
              jsonEvents.push(event);
            } else {
              renderEvent(event, ctx, options);
            }

            if (event.type === 'agent_runtime_end') {
              const outcome = outcomeFromEndEvent(event);
              if (options.json) {
                printJsonOnce();
              } else {
                renderEnd(event, outcome);
              }
              return outcome;
            }

            if (event.type === 'error') {
              printJsonOnce();
              const outcome = outcomeFromErrorEvent(event);
              log.error(`Agent error: ${outcome.error}`);
              return outcome;
            }
          } catch {
            // Not JSON, skip
          }

          eventType = '';
          eventData = '';
        }
      }
    }

    // Stream ended without agent_runtime_end
    printJsonOnce();
    return undefined;
  } finally {
    finished = true;
    if (stallTimer) clearTimeout(stallTimer);
    reader.releaseLock();
  }
}

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

const HEARTBEAT_INTERVAL = 30_000;

/**
 * Connect to the Agent Gateway via WebSocket and render events to the terminal.
 * Resolves with the run outcome once a terminal event arrives, `undefined` when
 * the gateway completed the session without one, and rejects when the
 * connection fails so the caller can fall back to polling.
 */
export async function streamAgentEventsViaWebSocket(
  options: WebSocketStreamOptions,
): Promise<AgentRunOutcome | undefined> {
  const {
    gatewayUrl,
    onStall,
    operationId,
    serverUrl,
    stallTimeoutMs = STALL_TIMEOUT,
    token,
    tokenType = 'jwt',
    ...streamOpts
  } = options;
  const wsUrl = urlJoin(
    gatewayUrl.replace(/^http/, 'ws'),
    `/ws?operationId=${encodeURIComponent(operationId)}`,
  );

  log.debug(`Connecting to gateway: ${wsUrl} (auth: ${tokenType})`);

  return new Promise<AgentRunOutcome | undefined>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const jsonEvents: AgentStreamEvent[] = [];
    const ctx = createRenderContext();
    let lastEventId = '';
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let isSettled = false;
    let jsonPrinted = false;

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (stallTimer) clearTimeout(stallTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    // Same `--json` contract as SSE: exactly one array per run, `[]` included.
    const printJsonOnce = () => {
      if (streamOpts.json && !jsonPrinted) {
        jsonPrinted = true;
        console.log(JSON.stringify(jsonEvents, null, 2));
      }
    };

    const settle = (outcome: AgentRunOutcome | undefined) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(outcome);
    };

    const fail = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      printJsonOnce();
      reject(error);
    };

    // Progress window: restarted by real stream traffic only. `heartbeat_ack`
    // must not restart it — a gateway that keeps acking while never forwarding
    // the terminal event is exactly the shape that used to hang forever.
    const armStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(async () => {
        if (isSettled) return;
        const silence = `Agent gateway WebSocket sent no progress for ${Math.round(stallTimeoutMs / 1000)}s`;
        if (!onStall) {
          fail(new Error(`${silence} and never reported completion`));
          return;
        }
        log.debug(`${silence}; checking the run status`);
        try {
          const outcome = await onStall();
          if (isSettled) return;
          if (outcome) {
            if (!streamOpts.json) renderOutcome(outcome);
            printJsonOnce();
            settle(outcome);
          } else {
            armStallTimer();
          }
        } catch (error) {
          fail(new Error(`${silence}; status check failed: ${(error as Error).message}`));
        }
      }, stallTimeoutMs);
    };

    ws.onopen = () => {
      // `serverUrl` is required so the gateway can call back to verify an
      // apiKey token. Harmless (but unused) for JWT, so we always include it
      // when available to match the device-gateway-client contract.
      ws.send(JSON.stringify({ serverUrl, token, tokenType, type: 'auth' }));
      armStallTimer();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type !== 'heartbeat_ack') armStallTimer();

      if (msg.type === 'auth_success') {
        log.debug('Gateway authenticated');
        // Request all buffered events (covers events pushed before WS connected)
        ws.send(JSON.stringify({ lastEventId: '', type: 'resume' }));
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, HEARTBEAT_INTERVAL);
        // The heartbeat alone must never keep the process alive.
        heartbeatTimer.unref?.();
        return;
      }

      if (msg.type === 'auth_failed') {
        fail(new Error(`Gateway auth failed: ${msg.reason}`));
        return;
      }

      if (msg.type === 'heartbeat_ack') return;

      if (msg.type === 'agent_event') {
        const agentEvent: AgentStreamEvent = msg.event;
        if (msg.id) lastEventId = msg.id;

        if (streamOpts.json) {
          jsonEvents.push(agentEvent);
        } else {
          renderEvent(agentEvent, ctx, streamOpts);
        }

        if (agentEvent.type === 'agent_runtime_end') {
          if (isSettled) return;
          const outcome = outcomeFromEndEvent(agentEvent);
          if (!streamOpts.json) renderEnd(agentEvent, outcome);
          printJsonOnce();
          settle(outcome);
          return;
        }

        if (agentEvent.type === 'error') {
          if (isSettled) return;
          const outcome = outcomeFromErrorEvent(agentEvent);
          printJsonOnce();
          log.error(`Agent error: ${outcome.error}`);
          settle(outcome);
          return;
        }
      }

      if (msg.type === 'session_complete') {
        printJsonOnce();
        settle(undefined);
      }
    };

    ws.onerror = (err) => {
      fail(new Error(`Agent gateway WebSocket failed: ${String(err)}`));
    };

    ws.onclose = (event) => {
      // Surface the close code + reason — `String(event)` is just "[object CloseEvent]".
      const reason = event.reason ? `: ${event.reason}` : '';
      fail(
        new Error(`Agent gateway WebSocket closed before completion (code ${event.code}${reason})`),
      );
    };
  });
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
