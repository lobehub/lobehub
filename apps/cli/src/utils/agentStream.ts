import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import pc from 'picocolors';
import urlJoin from 'url-join';

import { log } from './logger';

export type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

interface StreamOptions {
  json?: boolean;
  verbose?: boolean;
}

interface WebSocketStreamOptions extends StreamOptions {
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
 * Connect to the agent SSE stream and render events to the terminal.
 * Resolves when the stream ends (agent_runtime_end or connection close).
 */
export async function streamAgentEvents(
  url: string,
  headers: Record<string, string>,
  options: StreamOptions = {},
): Promise<void> {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text();
    log.error(`Agent stream failed: ${res.status} ${text}`);
    process.exit(1);
  }

  if (!res.body) {
    log.error('No response body received from agent stream');
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const jsonEvents: AgentStreamEvent[] = [];
  const ctx = createRenderContext();

  // Declared outside the read loop so partial SSE frames that span
  // chunk boundaries are not lost between reader.read() calls.
  let eventType = '';
  let eventData = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
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

          try {
            const event: AgentStreamEvent = JSON.parse(eventData);

            if (options.json) {
              jsonEvents.push(event);
            } else {
              renderEvent(event, ctx, options);
            }

            if (event.type === 'agent_runtime_end') {
              if (options.json) {
                console.log(JSON.stringify(jsonEvents, null, 2));
              } else {
                renderEnd(event);
              }
              return;
            }

            if (event.type === 'error') {
              if (options.json) {
                console.log(JSON.stringify(jsonEvents, null, 2));
              }
              log.error(
                `Agent error: ${event.data?.message || event.data?.error || 'Unknown error'}`,
              );
              process.exit(1);
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
    if (options.json && jsonEvents.length > 0) {
      console.log(JSON.stringify(jsonEvents, null, 2));
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Replay previously saved JSON events (from --json output) to the terminal.
 * No network calls needed.
 */
export function replayAgentEvents(events: AgentStreamEvent[], options: StreamOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  const ctx = createRenderContext();

  for (const event of events) {
    if (!event.type) continue;

    renderEvent(event, ctx, options);

    if (event.type === 'agent_runtime_end') {
      renderEnd(event);
      return;
    }

    if (event.type === 'error') {
      log.error(`Agent error: ${event.data?.message || event.data?.error || 'Unknown error'}`);
      return;
    }
  }
}

const HEARTBEAT_INTERVAL = 30_000;

/**
 * How long the WebSocket stream may go without PROGRESS before it gives up.
 *
 * The SSE path ends on its own: `streamAgentEvents` reads the response body to
 * the end, so the server closing the response returns the function. The
 * WebSocket path has no equivalent -- it settles only on `agent_runtime_end`,
 * `session_complete`, `onerror` or `onclose`, so a gateway that authenticates
 * and then sends none of those leaves the promise pending forever while the
 * heartbeat interval holds the event loop open. `lh agent run` then never
 * exits and produces no exit code, which is what `--sse` worked around (#19543).
 *
 * Measured against a gateway that authenticates, acks heartbeats and sends
 * nothing else: the client was still running when a 12s external cap killed it.
 */
const PROGRESS_TIMEOUT = 300_000;

/**
 * How long the socket may take to open and finish the auth handshake.
 *
 * The deadline above only starts at `auth_success`, so it covers nothing
 * before the gateway authenticates. A gateway that completes the WebSocket
 * upgrade and then answers neither `auth_success` nor `auth_failed` leaves a
 * live, healthy connection behind, and a live connection need never fire
 * `onerror` or `onclose` -- so nothing was armed at all and the promise stayed
 * pending exactly as it did after auth (#19543).
 *
 * Generous on purpose: the window covers the TCP connect, the upgrade, and an
 * apiKey handshake, where the gateway calls back to `serverUrl` to verify the
 * token before it answers.
 */
const HANDSHAKE_TIMEOUT = 30_000;

/**
 * Connect to the Agent Gateway via WebSocket and render events to the terminal.
 * Resolves when the session completes or the connection closes.
 */
export async function streamAgentEventsViaWebSocket(
  options: WebSocketStreamOptions,
): Promise<void> {
  const { gatewayUrl, operationId, serverUrl, token, tokenType = 'jwt', ...streamOpts } = options;
  const wsUrl = urlJoin(
    gatewayUrl.replace(/^http/, 'ws'),
    `/ws?operationId=${encodeURIComponent(operationId)}`,
  );

  log.debug(`Connecting to gateway: ${wsUrl} (auth: ${tokenType})`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const jsonEvents: AgentStreamEvent[] = [];
    const ctx = createRenderContext();
    let lastEventId = '';
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let isSettled = false;
    let jsonPrinted = false;

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearTimeout(handshakeTimer);
      if (progressTimer) clearTimeout(progressTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    /** Flush any buffered JSON, tear the socket down, and fail the stream. */
    const failStream = (message: string) => {
      if (isSettled) return;
      isSettled = true;
      if (streamOpts.json && jsonEvents.length > 0 && !jsonPrinted) {
        jsonPrinted = true;
        console.log(JSON.stringify(jsonEvents, null, 2));
      }
      cleanup();
      reject(new Error(message));
    };

    /**
     * Armed at connect time, cleared by `auth_success`, which hands the wait
     * over to the progress deadline. Neither is unref'd: each is the handle
     * that settles the promise on its own path, so it has to keep the process
     * alive -- which makes clearing it on every exit path part of the fix.
     */
    const handshakeTimer = setTimeout(() => {
      failStream(
        `Agent gateway WebSocket did not complete the auth handshake within ${HANDSHAKE_TIMEOUT / 1000}s. ` +
          `Check the gateway URL and credentials, and re-run with --sse, which ends when the server closes the response.`,
      );
    }, HANDSHAKE_TIMEOUT);

    /**
     * Restarted by PROGRESS, not by liveness.
     *
     * `heartbeat_ack` deliberately does not reset it: the reproduced failure is
     * a gateway that keeps acking heartbeats while the run is already finished
     * server-side, so a deadline that counted an ack as progress would be reset
     * every 30s and never fire -- the same infinite wait with extra steps.
     */
    const armProgressTimeout = () => {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = setTimeout(() => {
        failStream(
          `Agent gateway WebSocket sent no progress for ${PROGRESS_TIMEOUT / 1000}s and never reported completion. ` +
            `The run may have finished server-side; check the topic, and re-run with --sse, which ends when the server closes the response.`,
        );
      }, PROGRESS_TIMEOUT);
    };

    ws.onopen = () => {
      // `serverUrl` is required so the gateway can call back to verify an
      // apiKey token. Harmless (but unused) for JWT, so we always include it
      // when available to match the device-gateway-client contract.
      ws.send(JSON.stringify({ serverUrl, token, tokenType, type: 'auth' }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'auth_success') {
        log.debug('Gateway authenticated');
        clearTimeout(handshakeTimer);
        // Request all buffered events (covers events pushed before WS connected)
        ws.send(JSON.stringify({ lastEventId: '', type: 'resume' }));
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, HEARTBEAT_INTERVAL);
        // A heartbeat is liveness, not a reason to keep the process alive: on
        // its own it was the only handle holding the loop open after the run
        // had finished.
        heartbeatTimer.unref?.();
        armProgressTimeout();
        return;
      }

      if (msg.type === 'auth_failed') {
        cleanup();
        reject(new Error(`Gateway auth failed: ${msg.reason}`));
        return;
      }

      if (msg.type === 'heartbeat_ack') return;

      armProgressTimeout();

      if (msg.type === 'agent_event') {
        const agentEvent: AgentStreamEvent = msg.event;
        if (msg.id) lastEventId = msg.id;

        if (streamOpts.json) {
          jsonEvents.push(agentEvent);
        } else {
          renderEvent(agentEvent, ctx, streamOpts);
        }

        if (agentEvent.type === 'agent_runtime_end') {
          if (streamOpts.json && !jsonPrinted) {
            jsonPrinted = true;
            console.log(JSON.stringify(jsonEvents, null, 2));
          } else if (!streamOpts.json) {
            renderEnd(agentEvent);
          }
          if (isSettled) return;
          isSettled = true;
          cleanup();
          resolve();
          return;
        }

        if (agentEvent.type === 'error') {
          if (streamOpts.json && !jsonPrinted) {
            jsonPrinted = true;
            console.log(JSON.stringify(jsonEvents, null, 2));
          }
          log.error(
            `Agent error: ${agentEvent.data?.message || agentEvent.data?.error || 'Unknown error'}`,
          );
          cleanup();
          process.exit(1);
        }
      }

      if (msg.type === 'session_complete') {
        if (streamOpts.json && jsonEvents.length > 0 && !jsonPrinted) {
          jsonPrinted = true;
          console.log(JSON.stringify(jsonEvents, null, 2));
        }
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve();
      }
    };

    ws.onerror = (err) => {
      cleanup();
      if (isSettled) return;
      if (streamOpts.json && jsonEvents.length > 0 && !jsonPrinted) {
        jsonPrinted = true;
        console.log(JSON.stringify(jsonEvents, null, 2));
      }
      isSettled = true;
      reject(new Error(`Agent gateway WebSocket failed: ${String(err)}`));
    };

    ws.onclose = (event) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      clearTimeout(handshakeTimer);
      if (progressTimer) clearTimeout(progressTimer);
      if (isSettled) return;

      if (streamOpts.json && jsonEvents.length > 0 && !jsonPrinted) {
        jsonPrinted = true;
        console.log(JSON.stringify(jsonEvents, null, 2));
      }
      isSettled = true;
      // Surface the close code + reason — `String(event)` is just "[object CloseEvent]".
      const reason = event.reason ? `: ${event.reason}` : '';
      reject(
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
      log.toolResult(id, success, options.verbose ? event.data?.result?.content : timeSuffix);
      break;
    }

    case 'step_complete': {
      // Step finished, next step_start or agent_runtime_end will follow
      break;
    }
  }
}

function renderEnd(event: AgentStreamEvent): void {
  console.log();
  const data = event.data || {};
  const parts: string[] = [`${pc.green('✓')} Agent finished`];

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
