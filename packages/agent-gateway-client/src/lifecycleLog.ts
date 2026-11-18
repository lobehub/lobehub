import { isSessionTerminalEvent } from './terminalEvent';
import type { AgentStreamEvent } from './types';

/** Streaming events are too frequent to log; their lifecycle edges are not. */
const QUIET_EVENTS = new Set(['agent_event', 'connected', 'disconnected', 'resume_complete']);

const describeArgs = (event: string, args: unknown[]): string => {
  const [first] = args;
  if (event === 'status_changed' || event === 'auth_failed') return ` ${String(first)}`;
  if (event === 'reconnecting') return ` in ${String(first)}ms`;
  if (event === 'error') return ` ${first instanceof Error ? first.message : String(first)}`;
  if (event === 'session_complete') {
    const source = (first as { source?: unknown } | undefined)?.source;
    return source ? ` source=${String(source)}` : '';
  }
  return '';
};

/**
 * Logs a gateway stream's lifecycle with its operation id at `console.info`.
 * The Desktop main process records every window's console into
 * `renderer.jsonl`, and packaged builds keep only `info` and above unless the
 * user turns on debug logs; `info` keeps a user's connection history queryable
 * by the same `op_…` id the server's agent trace uses. Only lifecycle edges
 * are logged (a few lines per run), so the web console stays quiet.
 */
export const logGatewayLifecycle = (
  tag: string,
  operationId: string,
  event: string,
  args: unknown[],
) => {
  if (event === 'agent_event') {
    const agentEvent = args[0] as AgentStreamEvent | undefined;
    if (!agentEvent || !isSessionTerminalEvent(agentEvent)) return;
    if (agentEvent.operationId && agentEvent.operationId !== operationId) return;
    const reason = (agentEvent.data as { reason?: unknown } | undefined)?.reason;
    console.info(
      `[${tag}] ${operationId} terminal ${agentEvent.type}${reason ? ` reason=${String(reason)}` : ''}`,
    );
    return;
  }
  if (QUIET_EVENTS.has(event)) return;
  console.info(`[${tag}] ${operationId} ${event}${describeArgs(event, args)}`);
};
