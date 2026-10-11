import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { hasShareToolGrant, PLUGIN_SCHEMA_SEPARATOR, type ShareToolGrant } from '@lobechat/const';
import { isDeviceOnlyMcpEndpoint } from '@lobechat/utils/mcpEndpoint';

import { isGovernedByBuiltinAllowlist, SHARE_VISITOR_ALLOWED_IDENTIFIERS } from './allowlist';
import { DATA_TOOL_ACCESS_RULES } from './dataToolRules';
import { resolveEffectiveShareToolGrants } from './grants';
import { stripSubAgentDispatchApis } from './subAgentDispatch';
import {
  dropToolFromSet,
  generateOwnedToolNames,
  pruneArrayInPlace,
  stripApisFromTool,
} from './toolSetMutation';
import type { AgentShareGate, ShareGateToolSet } from './types';

/**
 * Apply {@link DATA_TOOL_ACCESS_RULES} to the assembled tool set: drop a data
 * tool entirely when its grant is `none`, or strip its write APIs (from both
 * the manifest and the function-calling `tools` schema) when the grant is
 * `read`. Runs as part of {@link applyShareGateToToolSet} — after that pass's
 * allowlist intersection has already decided which identifiers survive at all
 * — so this only needs to further restrict, never re-add.
 *
 * This is UX/defense-in-depth (the model is never offered the disallowed
 * function); the actual unbypassable enforcement is
 * {@link isShareBlockedDataToolCall} at the `BuiltinToolsExecutor` dispatch
 * site.
 */
const applyShareGateToDataToolAccess = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  for (const [identifier, rule] of Object.entries(DATA_TOOL_ACCESS_RULES)) {
    if (!toolSet.manifestMap[identifier]) continue;

    const grant = rule.grant(gate.shareConfig);

    if (grant === 'none') {
      dropToolFromSet(toolSet, identifier);
      continue;
    }

    // Under a `read` grant, strip both mutations (`writeApiNames`) AND the
    // creator-wide reads that no grant can honestly scope to this agent
    // (`alwaysBlockedApiNames`) — same treatment, since both are never offered
    // to the model regardless of grant. `isArgsOutOfScope`-covered APIs are
    // NOT stripped here: they stay offered because they CAN be in scope
    // depending on the id the model picks, and that per-call id check only
    // runs at dispatch time, not against a static manifest.
    const blockedApiNames = new Set([...rule.writeApiNames, ...(rule.alwaysBlockedApiNames ?? [])]);

    stripApisFromTool(toolSet, identifier, blockedApiNames);
  }
};

/**
 * Final allowlist enforcement for a share visitor's fully-assembled tool set.
 *
 * `shareConfig.toolGrants` is the single source of truth for what a share
 * visitor can see or run. This pass mutates `toolSet` in place and must run
 * once, after every manifest/default/dynamic-activation source has been merged
 * in, immediately before the operation's `toolSet` is persisted. An
 * empty/missing whitelist collapses the set to nothing (no built-in tool is
 * exempted; a share with no configured tools is a plain-chat run).
 */
export const applyShareGateToToolSet = (toolSet: ShareGateToolSet, gate: AgentShareGate): void => {
  const grants = resolveEffectiveShareToolGrants(gate.shareConfig);

  // A tool must clear BOTH gates: the owner's own `toolGrants` picker
  // (`grants` — toolset-level OR scoped to at least one API), AND — for
  // builtin identifiers only — the default-deny master allowlist
  // (`SHARE_VISITOR_ALLOWED_IDENTIFIERS`). Non-builtin identifiers (MCP/market/
  // custom plugins) are outside `isGovernedByBuiltinAllowlist`'s population, so
  // they pass straight through to the owner-picker check unaffected — this
  // allowlist must never decide their fate, in either direction.
  // MCP servers only the creator's machine can reach (stdio / localhost / LAN)
  // never survive, grant or not: dispatching one tunnels to the creator's
  // device under the creator's identity. Decided from the manifest's runtime
  // `mcpParams` (set for connector manifests by `buildConnectorManifests`),
  // the same field `ToolExecutionService.executeMCPTool` dispatches on — which
  // also refuses these calls for visitor runs as the unbypassable backstop.
  const deviceOnlyMcpIds = new Set(
    Object.entries(toolSet.manifestMap)
      .filter(([, manifest]) => {
        const mcpParams = (manifest as { mcpParams?: { type?: string; url?: string } }).mcpParams;
        return !!mcpParams && isDeviceOnlyMcpEndpoint(mcpParams);
      })
      .map(([id]) => id),
  );

  const isAllowed = (id: string) => {
    if (deviceOnlyMcpIds.has(id)) return false;
    if (!hasShareToolGrant(grants, id)) return false;
    if (!isGovernedByBuiltinAllowlist(id)) return true;
    return SHARE_VISITOR_ALLOWED_IDENTIFIERS.has(id);
  };

  // Prune arrays in place (`splice`, not reassignment) so this works whether
  // the caller's binding for `enabledToolIds` / `activatableToolIds` / `tools`
  // is a `const` array reference — callers only need to pass the array they
  // already hold, not receive a new one back.
  pruneArrayInPlace(toolSet.enabledToolIds, isAllowed);
  pruneArrayInPlace(toolSet.activatableToolIds, isAllowed);

  // Regenerate every allowed manifest's tool-call names BEFORE the manifests
  // are pruned: `ToolNameResolver.generate` MD5-hashes an identifier segment
  // that is non-ASCII or oversized, so the `tools[]` entry of such a tool does
  // not start with its literal identifier and a prefix-only check would drop
  // a granted MCP tool along with everything else (fail-closed, but breaks
  // the grant). See `pruneToolsForIdentifier` for the mirror-image, fail-OPEN
  // hazard on the per-API path.
  const allowedToolNames = new Set<string>();
  for (const [id, manifest] of Object.entries(toolSet.manifestMap)) {
    if (!isAllowed(id)) continue;
    for (const name of generateOwnedToolNames(id, manifest)) allowedToolNames.add(name);
  }

  for (const id of Object.keys(toolSet.manifestMap)) {
    if (!isAllowed(id)) delete toolSet.manifestMap[id];
  }
  for (const id of Object.keys(toolSet.sourceMap)) {
    if (!isAllowed(id)) delete toolSet.sourceMap[id];
  }
  for (const id of Object.keys(toolSet.executorMap)) {
    if (!isAllowed(id)) delete toolSet.executorMap[id];
  }

  if (toolSet.tools) {
    pruneArrayInPlace(toolSet.tools, (tool) => {
      const name: string | undefined = tool?.function?.name;
      if (!name) return false;
      if (allowedToolNames.has(name)) return true;
      // Fallback for an entry with no manifest to regenerate from — only its
      // literal identifier prefix can vouch for it.
      const identifier = name.split(PLUGIN_SCHEMA_SEPARATOR)[0];
      return !!identifier && isAllowed(identifier);
    });
  }

  stripSubAgentDispatchApis(toolSet);
  applyShareGateToDataToolAccess(toolSet, gate);
  applyShareGateToPerApiGrants(toolSet, grants);
  dropIdleActivator(toolSet);
};

/**
 * Drop `lobe-activator` when the gated set leaves it nothing to activate.
 *
 * Its grant is implied by any tool grant (`resolveEffectiveShareToolGrants`),
 * but the activator only ever discovers what is left in `manifestMap` and not
 * already enabled — the same difference `buildToolDiscoveryConfig` renders as
 * `<available_tools>`. When every granted tool is already enabled, keeping it
 * would offer the visitor's model an empty discovery tool. Runs after every
 * other pass so a tool those passes removed never keeps it alive.
 */
const dropIdleActivator = (toolSet: ShareGateToolSet): void => {
  if (!toolSet.manifestMap[LobeActivatorIdentifier]) return;

  const enabled = new Set(toolSet.enabledToolIds);
  const hasActivatableTool = Object.keys(toolSet.manifestMap).some(
    (id) => id !== LobeActivatorIdentifier && !enabled.has(id),
  );

  if (!hasActivatableTool) dropToolFromSet(toolSet, LobeActivatorIdentifier);
};

/**
 * Narrow each surviving tool's offered APIs down to what the owner's picker
 * actually granted for it. Runs LAST in {@link applyShareGateToToolSet}, after
 * every other strip (data-tool write/always-blocked APIs, sub-agent dispatch)
 * has already trimmed `manifest.api` — so a per-API grant
 * naming an API another rule already removed is simply a no-op here, never an
 * unstrip.
 *
 * A toolset-level entry (`grant === 'all'`) leaves the tool's remaining APIs
 * untouched. A per-API entry (`grant` is a `Set`) drops every remaining API
 * not named in it; if that empties the API list entirely, the tool is dropped
 * outright — the same treatment `applyShareGateToDataToolAccess` gives a
 * `'none'` grant, since an identifier with zero callable APIs offers a share
 * visitor's model nothing.
 *
 * Matches on the manifest's real `api[].name` list (via `stripApisFromTool`)
 * rather than parsing generated tool-call names directly:
 * `ToolNameResolver.generate` MD5-hashes an oversized or invalid-character API
 * segment, so the manifest is the only reliable source for which entries in
 * `toolSet.tools` belong to which granted API.
 */
const applyShareGateToPerApiGrants = (
  toolSet: ShareGateToolSet,
  grants: Map<string, ShareToolGrant>,
): void => {
  for (const identifier of Object.keys(toolSet.manifestMap)) {
    const grant = grants.get(identifier);
    if (!grant || grant === 'all') continue;

    const manifest = toolSet.manifestMap[identifier];
    if (!Array.isArray(manifest.api) || manifest.api.length === 0) continue;

    const blockedApiNames = new Set(
      manifest.api.filter((api) => !grant.has(api.name)).map((api) => api.name),
    );
    if (blockedApiNames.size === 0) continue;

    if (blockedApiNames.size === manifest.api.length) {
      dropToolFromSet(toolSet, identifier);
      continue;
    }

    stripApisFromTool(toolSet, identifier, blockedApiNames);
  }
};
