import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import { isSyncedMcpToolVisibleTo } from '@lobechat/const/mcpApp';
import { isMarketplaceInstallRunnable, mayRequireMandatoryApproval } from '@lobechat/const/plugin';
import { connectorToolIntervention } from '@lobechat/mecha';
import type {
  HumanInterventionConfig,
  HumanInterventionPolicy,
  ToolManifest,
} from '@lobechat/types';
import { getDisabledPluginIds } from '@lobechat/types';

import { resolveRunConnector, type RunConnector } from '@/services/connectorRun';
import { getRunConnectors } from '@/services/runConnectors';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { pickRunConnectors } from '@/store/tool/slices/connector/selectors';
import { getUserStoreState } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

import { connectorForTool } from './connectorForTool';

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
const PERMISSION_STRICTNESS: Record<string, number> = { auto: 1, disabled: 3, needs_approval: 2 };

const strictestPermission = (permissions: (string | undefined)[]): string | undefined =>
  permissions.reduce<string | undefined>(
    (strictest, permission) =>
      permission &&
      (PERMISSION_STRICTNESS[permission] ?? 0) > (PERMISSION_STRICTNESS[strictest ?? ''] ?? 0)
        ? permission
        : strictest,
    undefined,
  );

/**
 * A plugin tool's permission as the conversation applies it: plugin calls keep
 * the bare identifier, so the permission row is the one the run ranks first
 * for it (the owner's private row shadows the shared one in their private
 * agent's own topic, `pickRunConnectors`), not the row whose tool prefix the
 * identifier names. The server's listing for the conversation decides which
 * rows take part; without it any row of the identifier may be the one, so the
 * strictest setting among them holds.
 */
const pluginToolPermission = (
  identifier: string,
  toolName: string,
  run: { agentId?: string; topicId?: string },
): string | undefined => {
  const s = getToolStoreState();
  const listed = run.agentId ? getRunConnectors(run) : undefined;
  const rows = listed
    ? pickRunConnectors(
        listed.filter((c) => c.identifier === identifier),
        { agentId: run.agentId, includePrivate: true },
      )
    : [
        ...(s.connectors ?? []),
        ...(run.agentId ? (s.agentConnectors?.[run.agentId] ?? []) : []),
      ].filter((c) => c.identifier === identifier);
  return strictestPermission(
    rows.map((c) => c.tools.find((t) => t.toolName === toolName)?.permission),
  );
};

const findToolIntervention = (
  /**
   * The connector the call runs on ({@link resolveRunConnector}): approval is
   * the executing row's, never a same-named row the conversation can't use.
   */
  resolved: RunConnector | undefined,
  identifier: string,
  toolName: string,
  agentId: string | undefined,
  /** The lists were just loaded from the server; if not, nothing here can waive approval. */
  revalidated: boolean,
  fromEntrypoint = false,
  /** A plugin tool's permission as the conversation applies it ({@link pluginToolPermission}). */
  pluginPermission?: string,
): ToolLookup => {
  const s = getToolStoreState();
  const confirmed = revalidated && s.isConnectorListConfirmed(agentId);

  const plugin =
    pluginSelectors.getInstalledPluginById(identifier)(s) ||
    pluginSelectors.getCustomPluginById(identifier)(s);
  // Same routing as `mcpService.invokeMcpToolCall`: an unfinished marketplace
  // install is not run, so the plugin row it falls back to decides
  const connector =
    resolved && isMarketplaceInstallRunnable(resolved, !!plugin) ? resolved : undefined;
  if (fromEntrypoint && connector && !connector.isEnabled) return null;
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
    if (
      tool.permission === 'disabled' ||
      (!fromEntrypoint && !isSyncedMcpToolVisibleTo(tool, 'app', true))
    )
      return null;
    // Same mapping as the connector manifest (`buildConnectorManifest`)
    return { intervention: connectorToolIntervention(tool) };
  }

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
  if (!fromEntrypoint && manifest?.mcpModelOnlyTools?.includes(toolName)) return null;
  const api = [...(manifest?.api ?? []), ...(manifest?.mcpAppOnlyApi ?? [])].find(
    (item) => item.name === toolName,
  );

  // A plugin's tool permissions live on a connector of the same identifier
  // (syncPluginTools), applied as the conversation applies them
  // (patchManifestWithPermissions). Until the server confirms the lists they
  // may be stale or missing, so ask.
  if (!confirmed) return { intervention: 'required' };
  // The row the identifier names and the row the conversation ranks first for
  // it: the stricter setting holds
  const permission = strictestPermission([
    resolved?.tools.find((t) => t.toolName === toolName)?.permission,
    pluginPermission,
  ]);
  if (permission === 'disabled') return null;
  // Never looser than the tool's own `always` (`patchManifestWithPermissions`)
  if (permission === 'needs_approval')
    return {
      intervention: mayRequireMandatoryApproval(
        api?.humanIntervention ?? manifest?.humanIntervention,
      )
        ? 'always'
        : 'required',
    };

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

/**
 * The tool's setting on the connector the call runs on. Without an answer from
 * the server about which row that is, it asks.
 */
const lookUpTool = async (
  identifier: string,
  toolName: string,
  run: { agentId?: string; topicId?: string },
  revalidated: boolean,
  fromEntrypoint = false,
): Promise<ToolLookup> => {
  let connector: RunConnector | undefined;
  try {
    connector = await resolveRunConnector(identifier, run);
  } catch (error) {
    console.warn('[MCPApp] failed to resolve the connector of a view tool call:', error);
    return { intervention: 'required' };
  }
  return findToolIntervention(
    connector,
    identifier,
    toolName,
    run.agentId,
    revalidated,
    fromEntrypoint,
    pluginToolPermission(identifier, toolName, run),
  );
};

export const getAppToolCallPolicy = async (
  identifier: string,
  toolName: string,
  {
    agentId,
    toolArgs = {},
    fromEntrypoint = false,
    topicId,
  }: {
    agentId?: string;
    toolArgs?: Record<string, unknown>;
    fromEntrypoint?: boolean;
    /** The conversation the view's result belongs to; its calls run in it. */
    topicId?: string;
  } = {},
): Promise<AppToolCallPolicy> => {
  if (
    fromEntrypoint &&
    agentId &&
    getDisabledPluginIds(
      agentSelectors.getAgentConfigById(agentId)(getAgentStoreState())?.plugins,
      // The agent disables a connector, not one row's tool prefix
    ).includes(connectorForTool(identifier, agentId)(getToolStoreState())?.identifier ?? identifier)
  )
    return 'deny';
  if (fromEntrypoint) {
    const state = getToolStoreState();
    if (!pluginSelectors.isInstalledPluginsServerConfirmed(state)) {
      try {
        await state.refreshPlugins();
      } catch {
        return 'deny';
      }
    }
  }
  const revalidated = await revalidateConnectors(agentId);
  const run = { agentId, topicId };
  let tool = await lookUpTool(identifier, toolName, run, revalidated, fromEntrypoint);
  if (tool && 'missingFrom' in tool) {
    tool = (await resyncConnectorTools(tool.missingFrom))
      ? await lookUpTool(identifier, toolName, run, revalidated, fromEntrypoint)
      : null;
  }
  if (!tool || 'missingFrom' in tool) return 'deny';

  if (fromEntrypoint) return revalidated ? 'allow' : 'deny';

  const userState = getUserStoreState();

  return resolveAppToolCallPolicy({
    allowList: toolInterventionSelectors.allowList(userState),
    approvalMode: toolInterventionSelectors.approvalMode(userState),
    intervention: tool.intervention,
    toolArgs,
    toolKey: `${identifier}/${toolName}`,
  });
};
