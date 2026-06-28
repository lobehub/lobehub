import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

/**
 * A single agent stream event handler — the shape returned by
 * `createGatewayEventHandler` / `createGatewayMemberStreamHandler`.
 */
export type GatewayEventListener = (event: AgentStreamEvent) => void;

export interface GatewayEventRouterParams {
  /**
   * Lazily build a render-only handler for a non-owner operation whose events
   * are multiplexed onto this same WebSocket (e.g. a broadcast council member
   * forwarded via the server's `GatewayStreamNotifier` mirror). Called exactly
   * once per distinct operationId, on that op's first event.
   */
  createMemberHandler: (operationId: string) => GatewayEventListener;
  /**
   * Handler for the operation this WebSocket was opened for (the supervisor /
   * top-level op). Drives the full run lifecycle.
   */
  ownerHandler: GatewayEventListener;
  /**
   * The primary operationId the WebSocket subscribed to.
   */
  ownerOperationId: string;
}

/**
 * Demultiplexes a single Gateway WebSocket that carries events for more than
 * one `operationId`.
 *
 * The Gateway connection model is moving from per-operation (one WS per op) to
 * single-connection multiplexing (LOBE-10868): a broadcast supervisor's WS now
 * also receives the streaming events of each of its members, forwarded
 * server-side onto the supervisor's op channel. Every `AgentStreamEvent` already
 * carries its own `operationId`, so the routing key is intrinsic to the event —
 * we just need to fan it out to the right handler.
 *
 * - Events for `ownerOperationId` → `ownerHandler` (existing behavior, unchanged).
 * - Events for any other operationId → a render-only member handler, created
 *   lazily on first sighting and memoized for the connection's lifetime.
 * - Events with no `operationId` (older gateway builds, or events without
 *   lineage) fall back to the owner so behavior degrades to the legacy
 *   single-op path rather than dropping the event.
 *
 * Without this demux, member events arriving on the supervisor WS would be
 * processed by the supervisor handler and mis-dispatched into the supervisor
 * bubble — so the router MUST front any handler on a connection that can receive
 * forwarded member events.
 */
export const createGatewayEventRouter = (
  params: GatewayEventRouterParams,
): GatewayEventListener => {
  const { ownerOperationId, ownerHandler, createMemberHandler } = params;

  const memberHandlers = new Map<string, GatewayEventListener>();

  return (event: AgentStreamEvent): void => {
    const eventOperationId = event.operationId || ownerOperationId;

    if (eventOperationId === ownerOperationId) {
      ownerHandler(event);
      return;
    }

    let handler = memberHandlers.get(eventOperationId);
    if (!handler) {
      handler = createMemberHandler(eventOperationId);
      memberHandlers.set(eventOperationId, handler);
    }
    handler(event);
  };
};
