import debug from 'debug';

import { ConnectorMcpConnectionType } from '@/database/schemas';
import { after } from '@/server/utils/scheduleAfterResponse';

import { type ConnectorToolSyncContext, syncConnectorToolsById } from './sync';

const log = debug('lobe-server:connector-refresh');

/**
 * Refresh a connector's synced tool list at most once per this window. Picked to
 * keep the list fresh through normal use without hammering the upstream MCP
 * server on every tool call / chat run.
 */
export const CONNECTOR_TOOLS_REFRESH_TTL_MS = 10 * 60 * 1000;

/**
 * Per-instance guard so concurrent requests (many tool calls in one turn, or
 * parallel chats) don't fan out multiple upstream syncs for the same connector.
 * Best-effort only — a fresh serverless instance starts empty, which the TTL
 * check still bounds.
 */
const inFlight = new Set<string>();

export interface StaleRefreshConnector {
  id: string;
  mcpConnectionType: ConnectorMcpConnectionType | string | null;
  mcpServerUrl: string | null;
}

/**
 * Build the `connectorId → last-sync epoch ms` map from already-fetched tool
 * rows, so callers reuse the rows they loaded anyway instead of issuing an extra
 * query. A tool's `updatedAt` is bumped on every `upsertMany` sync, so the max
 * across a connector's tools is a good proxy for "last synced". A connector with
 * no tools maps to nothing (treated as never synced → eligible to refresh).
 */
export const buildLastSyncedAtMap = (
  tools: { updatedAt?: Date | null; userConnectorId: string }[],
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const tool of tools) {
    const ts = tool.updatedAt ? tool.updatedAt.getTime() : 0;
    const prev = map.get(tool.userConnectorId) ?? 0;
    map.set(tool.userConnectorId, Math.max(prev, ts));
  }
  return map;
};

/**
 * Background-refresh stale connector tool lists — the auto-update the connectors
 * migration dropped.
 *
 * The old plugin system silently re-fetched every plugin's manifest on each chat
 * load, so upstream MCP tool changes showed up without any user action. Connectors
 * only re-fetch on the manual Refresh button / OAuth callback, so a user's tool
 * list stays frozen at install time until they re-sync by hand (the "必须手动进技能
 * 管理更新" complaint). This reinstates that freshness at the tool-call / chat-run
 * boundary:
 *
 * - **HTTP connectors only** — stdio servers must spawn on the user's own machine,
 *   not the cloud server, so we never auto-connect them here.
 * - **Throttled** to one sync per connector per {@link CONNECTOR_TOOLS_REFRESH_TTL_MS}
 *   using the tools' own `updatedAt` as the last-sync marker (no schema change).
 * - **Deferred** via `after()` so it runs past the response — zero added latency.
 *   Refreshed tools therefore take effect on the *next* run, which is fine for a
 *   background freshness sweep, and failures are swallowed (never user-facing).
 */
export const scheduleStaleConnectorToolsRefresh = (
  connectors: StaleRefreshConnector[],
  lastSyncedAtById: Map<string, number>,
  ctx: ConnectorToolSyncContext,
  now: number = Date.now(),
): void => {
  // This runs inline on the request/agent-run hot path. It is a best-effort
  // optimization only: under NO circumstances may it throw into the caller and
  // break the tool call or chat flow. Every step is guarded so a bad input, a
  // logging failure, or an `after()` scheduling failure is swallowed here.
  for (const connector of connectors) {
    try {
      // stdio can't be refreshed server-side (the binary lives on the user's
      // machine); skip anything without an HTTP endpoint.
      if (connector.mcpConnectionType === ConnectorMcpConnectionType.stdio) continue;
      if (!connector.mcpServerUrl) continue;

      const lastSyncedAt = lastSyncedAtById.get(connector.id) ?? 0;
      if (now - lastSyncedAt < CONNECTOR_TOOLS_REFRESH_TTL_MS) continue;

      if (inFlight.has(connector.id)) continue;
      const { id } = connector;
      inFlight.add(id);

      try {
        after(async () => {
          try {
            const { toolCount } = await syncConnectorToolsById(id, ctx);
            log('auto-refreshed connector %s: %d tools', id, toolCount);
          } catch (err) {
            // Remote unreachable / auth failure / etc. — best-effort background
            // sweep, never surfaced to the user.
            log('auto-refresh failed for connector %s: %O', id, err);
          } finally {
            // Always release the guard, even after a failed sync, so a later
            // request can retry instead of the connector being stuck.
            inFlight.delete(id);
          }
        });
      } catch (err) {
        // `after()` failed to even schedule the work — release the guard so we
        // don't permanently block this connector, and swallow.
        inFlight.delete(id);
        log('failed to schedule refresh for connector %s: %O', id, err);
      }
    } catch (err) {
      // Defensive: never let background-refresh bookkeeping touch the caller.
      log('unexpected error while scheduling connector refresh: %O', err);
    }
  }
};
