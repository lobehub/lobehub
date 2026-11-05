import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import { isSyncedMcpToolVisibleTo } from '@lobechat/const/mcpApp';
import type {
  HumanInterventionConfig,
  HumanInterventionPolicy,
  ToolManifest,
} from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { getUserStoreState } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

/**
 * What LobeHub does with a `tools/call` a view sends. A view can call tools on
 * load without any user gesture, so a call the conversation would stop for
 * approval must ask here too, and a tool known not to be offered to views is
 * refused before it reaches the server.
 */
export type AppToolCallPolicy = 'allow' | 'confirm' | 'deny';

const matchesSecurityBlacklist = (policy: HumanInterventionPolicy, toolArgs: object) =>
  InterventionChecker.checkSecurityBlacklist(
    DEFAULT_SECURITY_BLACKLIST.filter((rule) => (rule.policy ?? 'always') === policy),
    toolArgs,
  ).blocked;

const isDynamicConfig = (config: unknown) =>
  !!config && typeof config === 'object' && !Array.isArray(config) && 'dynamic' in config;

/**
 * Whether a view's call runs at once or asks first: the same decision, in the
 * same order, as the conversation's approval gate
 * (`GeneralChatAgent.checkInterventionNeeded`), under the user's approval mode
 * and allow-list.
 */
export const resolveAppToolCallPolicy = ({
  allowList,
  approvalMode,
  intervention,
  toolArgs,
  toolKey,
}: {
  allowList: string[];
  approvalMode: string;
  /** The tool's own `humanIntervention`; undefined when it sets none. */
  intervention: unknown;
  toolArgs: Record<string, unknown>;
  /** `identifier/apiName`, the allow-list entry. */
  toolKey: string;
}): Exclude<AppToolCallPolicy, 'deny'> => {
  if (matchesSecurityBlacklist('always', toolArgs)) return 'confirm';

  // A dynamic policy needs a resolver the client doesn't have: MCP tools never
  // declare one, so treat it as asking unless the user waived approval.
  const policy = isDynamicConfig(intervention)
    ? 'required'
    : InterventionChecker.shouldIntervene({
        config: intervention as HumanInterventionConfig | undefined,
        // The security pass already ran above, split by policy like the runtime's audits
        securityBlacklist: [],
        toolArgs,
      });
  if (policy === 'always') return 'confirm';

  if (approvalMode === 'auto-run' || approvalMode === 'headless') return 'allow';
  if (matchesSecurityBlacklist('required', toolArgs)) return 'confirm';
  if (allowList.includes(toolKey)) return 'allow';
  if (approvalMode === 'allow-list') return 'confirm';

  return policy === 'never' ? 'allow' : 'confirm';
};

/**
 * What the conversation's lists say about a tool: its own approval setting,
 * null when the server doesn't offer it to views, or `missingFrom` when its
 * connector's synced tools lack it.
 */
type ToolLookup = { intervention?: unknown } | { missingFrom: string } | null;

/**
 * The tool's own approval setting as the conversation's manifest carries it,
 * or null when the server doesn't offer the tool.
 */
const findToolIntervention = (
  identifier: string,
  toolName: string,
  agentId: string | undefined,
  /** The lists were just loaded from the server; if not, nothing here can waive approval. */
  revalidated: boolean,
): ToolLookup => {
  const s = getToolStoreState();
  const confirmed = revalidated && s.isConnectorListConfirmed(agentId);

  const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);
  // Same routing as `mcpService.invokeMcpToolCall`
  if (
    connector?.isEnabled &&
    (!!connector.mcpServerUrl || connector.mcpConnectionType === 'stdio')
  ) {
    // Until the server confirms the lists, this row may be the base connector
    // standing in for the agent's stricter copy, or a stale copy painted from
    // storage: neither can waive approval, so ask.
    if (!confirmed) return { intervention: 'required' };
    const tool = connector.tools.find((t) => t.toolName === toolName);
    // Synced before MCP Apps was on, the list may lack the tools the server
    // offers only to views
    if (!tool) return { missingFrom: connector.id };
    // A tool only the model may call is refused before anyone is asked about it
    if (tool.permission === 'disabled' || !isSyncedMcpToolVisibleTo(tool, 'app')) return null;
    // Same mapping as the connector manifest (`patchManifestWithPermissions`)
    return { intervention: tool.permission === 'needs_approval' ? 'required' : undefined };
  }

  const plugin =
    pluginSelectors.getInstalledPluginById(identifier)(s) ||
    pluginSelectors.getCustomPluginById(identifier)(s);
  // An agent's own connector the client hasn't loaded: its permission is
  // unknown here, so treat it as needing approval.
  if (!plugin) return agentId ? { intervention: 'required' } : null;

  const manifest = plugin.manifest as
    | (Pick<ToolManifest, 'mcpAppOnlyApi' | 'mcpModelOnlyTools'> & {
        api?: { humanIntervention?: unknown; name: string }[];
        humanIntervention?: unknown;
      })
    | undefined;
  // MCP Apps visibility: a tool only the model may call is refused to views, and
  // one kept from the model is still the view's to call
  if (manifest?.mcpModelOnlyTools?.includes(toolName)) return null;
  const api = [...(manifest?.api ?? []), ...(manifest?.mcpAppOnlyApi ?? [])].find(
    (item) => item.name === toolName,
  );

  // A plugin's tool permissions live on a connector of the same identifier
  // (syncPluginTools), applied as the conversation applies them
  // (patchManifestWithPermissions). Until the server confirms the lists they
  // may be stale or missing, so ask.
  if (!confirmed) return { intervention: 'required' };
  const permission = connector?.tools.find((t) => t.toolName === toolName)?.permission;
  if (permission === 'disabled') return null;
  if (permission === 'needs_approval') return { intervention: 'required' };

  // A manifest stored before MCP Apps was on lacks the tools its server offers
  // only to views. Ask rather than refuse: the session the call runs on still
  // refuses any tool the server doesn't offer to views.
  if (!api) return { intervention: 'required' };

  return { intervention: api.humanIntervention ?? manifest?.humanIntervention };
};

/**
 * Load the connector lists from the server before every call (the agent's own
 * tools too), so the policy and the call that follows resolve the connector
 * the server will run, under its current permissions: one may have changed
 * since the view opened. If they can't be loaded, the policy asks.
 */
const revalidateConnectors = async (agentId: string | undefined): Promise<boolean> => {
  try {
    await getToolStoreState().ensureConfirmedConnectors(agentId, { revalidate: true });
    return true;
  } catch (error) {
    console.warn('[MCPApp] failed to load the connectors for a view tool call:', error);
    return false;
  }
};

// The resync a view's call started for each connector on this page: pending, or done
const connectorResyncs = new Map<string, Promise<boolean>>();

/**
 * Sync a connector's tools again, once per page, so a list synced before MCP
 * Apps was on picks up the tools its server offers only to views (stdio ones
 * too, which only this desktop can list). Calls made meanwhile wait for the
 * same sync; one that failed is tried again by the next call. Whether it
 * succeeded.
 */
const resyncConnectorTools = (connectorId: string): Promise<boolean> => {
  let resync = connectorResyncs.get(connectorId);
  if (!resync) {
    resync = getToolStoreState()
      .syncConnectorTools(connectorId)
      .then(
        () => true,
        (error) => {
          console.warn(
            '[MCPApp] failed to sync the tools of a connector for a view tool call:',
            error,
          );
          // A failed sync may succeed later: the next call tries again
          connectorResyncs.delete(connectorId);
          return false;
        },
      );
    connectorResyncs.set(connectorId, resync);
  }
  return resync;
};

export const getAppToolCallPolicy = async (
  identifier: string,
  toolName: string,
  { agentId, toolArgs = {} }: { agentId?: string; toolArgs?: Record<string, unknown> } = {},
): Promise<AppToolCallPolicy> => {
  const revalidated = await revalidateConnectors(agentId);
  let tool = findToolIntervention(identifier, toolName, agentId, revalidated);
  if (tool && 'missingFrom' in tool) {
    tool = (await resyncConnectorTools(tool.missingFrom))
      ? findToolIntervention(identifier, toolName, agentId, revalidated)
      : null;
  }
  if (!tool || 'missingFrom' in tool) return 'deny';

  const userState = getUserStoreState();

  return resolveAppToolCallPolicy({
    allowList: toolInterventionSelectors.allowList(userState),
    approvalMode: toolInterventionSelectors.approvalMode(userState),
    intervention: tool.intervention,
    toolArgs,
    toolKey: `${identifier}/${toolName}`,
  });
};
