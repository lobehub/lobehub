import type { LobeToolManifest } from '@lobechat/context-engine';
import debug from 'debug';
import pMap from 'p-map';

import { ConnectorModel, type DecryptedConnector } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import type { UserConnectorToolItem } from '@/database/schemas';
import { patchManifestWithPermissions } from '@/libs/mcp/connectorPermissionCheck';
import type { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  buildLastSyncedAtMap,
  scheduleStaleConnectorToolsRefresh,
} from '@/server/services/connector/refresh';
import {
  buildConnectorOwnershipPrompt,
  collectBorrowedConnectors,
  resolveUserDisplayMap,
} from '@/server/utils/connectorAttribution';

import type { ToolDiscoveryDeps } from './types';

/** Caps concurrent per-connector permission reads against the database. */
const CONNECTOR_TOOLS_QUERY_CONCURRENCY = 5;

const log = debug('lobe-server:ai-agent-service');

/**
 * Model awareness: when the caller runs a shared agent whose tools were
 * authorized by OTHER members (workspace dimension), tell the model whose
 * connected account each such tool runs on. Skipped entirely when the caller
 * authorized everything (owner runs own agent → empty set), so it costs
 * nothing in the common case.
 *
 * Returned as run context for the context engine to inject, rather than
 * concatenated onto the agent's systemRole here. Never fails the run.
 */
export const buildOwnershipNote = async (
  deps: ToolDiscoveryDeps,
  connectors: DecryptedConnector[],
): Promise<string | undefined> => {
  try {
    const borrowed = collectBorrowedConnectors(connectors, deps.userId!);
    if (borrowed.length > 0) {
      const displayMap = await resolveUserDisplayMap(
        deps.db,
        borrowed.map((b) => b.authorizerId),
      );
      const note = buildConnectorOwnershipPrompt(borrowed, displayMap);
      if (note) {
        log(
          'execAgent: injected tool credential ownership note for %d connector(s)',
          borrowed.length,
        );
        return note;
      }
    }
  } catch (err) {
    log('execAgent: failed to build tool credential ownership note: %O', err);
  }
  return undefined;
};

/**
 * Auto-refresh stale connector tool lists in the background so upstream MCP
 * tool changes propagate without the user manually re-syncing — the freshness
 * the connectors migration lost from the old plugin system. Reuses the tools
 * just fetched as the last-sync marker (no extra query), HTTP-only, throttled,
 * and deferred via after() so it adds no latency to this run. Wrapped
 * defensively: it is a pure optimization and must never break the agent run.
 */
export const scheduleConnectorRefresh = (
  deps: ToolDiscoveryDeps,
  params: {
    connectorGateKeeper: KeyVaultsGateKeeper | undefined;
    connectorsMcp: DecryptedConnector[];
    connectorTools: UserConnectorToolItem[];
    discoverableConnectorsMcp: DecryptedConnector[];
    discoverableConnectorTools: UserConnectorToolItem[];
  },
) => {
  try {
    // The background sync decrypts stored OAuth/bearer credentials to auth
    // against the MCP server, so it needs a gatekeeper-backed model — the
    // same `connectorGateKeeper` used for resolution. `deps.connectorModel`
    // has none, which would decrypt to null and make an authed connector 401 → error.
    const refreshConnectorModel = params.connectorGateKeeper
      ? new ConnectorModel(deps.db, deps.userId, deps.workspaceId, params.connectorGateKeeper)
      : deps.connectorModel;
    // Discoverable (unpinned) connectors are refreshed too: the model can
    // activate them, so a stale list would offer removed APIs and hide new ones.
    scheduleStaleConnectorToolsRefresh(
      [...params.connectorsMcp, ...params.discoverableConnectorsMcp],
      buildLastSyncedAtMap([...params.connectorTools, ...params.discoverableConnectorTools]),
      { connectorModel: refreshConnectorModel, connectorToolModel: deps.connectorToolModel },
    );
  } catch (err) {
    log('execAgent: failed to schedule connector tool refresh (ignored): %O', err);
  }
};

interface PermissionPatchTargets<P> {
  composioManifests: LobeToolManifest[];
  lobehubSkillManifests: LobeToolManifest[];
  pluginsWithoutConnectors: P[];
}

/**
 * Patch Lobehub/Composio manifests AND community-MCP plugin manifests with
 * connector tool permissions. This enables needs_approval (→
 * humanIntervention: 'required') and disabled (→ blocking description) for any
 * tool managed via the connector system but executed through a non-connector
 * path (Lobehub/Composio skills, community MCP plugins). The 'disabled'
 * hard-block is already enforced universally in ToolExecutionService; this
 * surfaces the permission to the model too.
 *
 * Returns the inputs unchanged when nothing applies or the lookup fails.
 */
export const patchConnectorPermissions = async <P extends { identifier: string }>(
  deps: ToolDiscoveryDeps,
  resolvedAgentId: string,
  targets: PermissionPatchTargets<P>,
): Promise<PermissionPatchTargets<P>> => {
  let { composioManifests, lobehubSkillManifests, pluginsWithoutConnectors } = targets;
  if (
    lobehubSkillManifests.length === 0 &&
    composioManifests.length === 0 &&
    pluginsWithoutConnectors.length === 0
  ) {
    return targets;
  }

  try {
    const allIdentifiers = [
      ...lobehubSkillManifests.map((m) => m.identifier),
      ...composioManifests.map((m) => m.identifier),
      ...pluginsWithoutConnectors.map((p) => p.identifier),
    ];
    const connectorEntries =
      allIdentifiers.length > 0
        ? await deps.connectorModel.resolveByIdentifiers(allIdentifiers, resolvedAgentId)
        : [];

    if (connectorEntries.length > 0) {
      const toolModel = new ConnectorToolModel(deps.db, deps.userId, deps.workspaceId);
      const connectorToolsMap = new Map<string, Map<string, string>>();
      await pMap(
        connectorEntries,
        async (c) => {
          const tools = await toolModel.queryByConnector(c.id);
          const perms = new Map(tools.map((t) => [t.toolName, t.permission]));
          connectorToolsMap.set(c.identifier, perms);
        },
        { concurrency: CONNECTOR_TOOLS_QUERY_CONCURRENCY },
      );

      lobehubSkillManifests = lobehubSkillManifests.map((m) => {
        const perms = connectorToolsMap.get(m.identifier);
        return perms && perms.size > 0
          ? (patchManifestWithPermissions(m as any, perms as any) as any)
          : m;
      });

      composioManifests = composioManifests.map((m) => {
        const perms = connectorToolsMap.get(m.identifier);
        return perms && perms.size > 0
          ? (patchManifestWithPermissions(m as any, perms as any) as any)
          : m;
      });

      // Community-MCP plugins execute via the plugin path, so patch their
      // manifest in place (the connector row holds the user's permissions).
      pluginsWithoutConnectors = pluginsWithoutConnectors.map((p) => {
        const perms = connectorToolsMap.get(p.identifier);
        if (perms && perms.size > 0 && (p as any).manifest?.api) {
          return {
            ...p,
            manifest: patchManifestWithPermissions((p as any).manifest, perms as any) as any,
          };
        }
        return p;
      });
    }
  } catch (err) {
    log('execAgent: failed to patch manifests with connector permissions: %O', err);
  }

  return { composioManifests, lobehubSkillManifests, pluginsWithoutConnectors };
};
