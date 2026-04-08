import pc from 'picocolors';
import urlJoin from 'url-join';

import { log } from './logger';

export interface AgentStreamEvent {
  data: any;
  id?: string;
  operationId: string;
  stepIndex: number;
  timestamp: number;
  type: string;
}

interface StreamOptions {
  json?: boolean;
  verbose?: boolean;
}

interface WebSocketStreamOptions extends StreamOptions {
  gatewayUrl: string;
  operationId: string;
  token: string;
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
 * Connect to the Agent Gateway via WebSocket and render events to the terminal.
 * Resolves when the session completes or the connection closes.
 */
export async function streamAgentEventsViaWebSocket(
  options: WebSocketStreamOptions,
): Promise<void> {
  const { gatewayUrl, operationId, token, ...streamOpts } = options;
  const wsUrl = urlJoin(
    gatewayUrl.replace(/^http/, 'ws'),
    `/ws?operationId=${encodeURIComponent(operationId)}`,
  );

  log.debug(`Connecting to gateway: ${wsUrl}`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const jsonEvents: AgentStreamEvent[] = [];
    const ctx = createRenderContext();
    let lastEventId = '';
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let jsonPrinted = false;

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ token, type: 'auth' }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'auth_success') {
        log.debug('Gateway authenticated');
        // Request all buffered events (covers events pushed before WS connected)
        ws.send(JSON.stringify({ lastEventId: '', type: 'resume' }));
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, HEARTBEAT_INTERVAL);
        return;
      }

      if (msg.type === 'auth_failed') {
        cleanup();
        reject(new Error(`Gateway auth failed: ${msg.reason}`));
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
          if (streamOpts.json && !jsonPrinted) {
            jsonPrinted = true;
            console.log(JSON.stringify(jsonEvents, null, 2));
          } else if (!streamOpts.json) {
            renderEnd(agentEvent);
          }
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
        cleanup();
        resolve();
      }
    };

    ws.onerror = (err) => {
      cleanup();
      reject(err);
    };

    ws.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (streamOpts.json && jsonEvents.length > 0 && !jsonPrinted) {
        jsonPrinted = true;
        console.log(JSON.stringify(jsonEvents, null, 2));
      }
      resolve();
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
