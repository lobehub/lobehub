import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import type { HumanInterventionConfig, HumanInterventionPolicy } from '@lobechat/types';

import { getToolStoreState } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { getUserStoreState } from '@/store/user';
import { toolInterventionSelectors } from '@/store/user/selectors';

/**
 * What LobeHub does with a `tools/call` a view sends. A view can call tools on
 * load without any user gesture, so a call the conversation would stop for
 * approval must ask here too, and a tool the server doesn't offer is refused
 * before it reaches the server.
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
 * The tool's own approval setting as the conversation's manifest carries it,
 * or null when the server doesn't offer the tool.
 */
const findToolIntervention = (
  identifier: string,
  toolName: string,
  agentId?: string,
): { intervention?: unknown } | null => {
  const s = getToolStoreState();

  const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);
  // Same routing as `mcpService.invokeMcpToolCall`
  if (
    connector?.isEnabled &&
    (!!connector.mcpServerUrl || connector.mcpConnectionType === 'stdio')
  ) {
    const tool = connector.tools.find((t) => t.toolName === toolName);
    if (!tool || tool.permission === 'disabled') return null;
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
    | { api?: { humanIntervention?: unknown; name: string }[]; humanIntervention?: unknown }
    | undefined;
  const api = manifest?.api?.find((item) => item.name === toolName);
  if (!api) return null;

  return { intervention: api.humanIntervention ?? manifest?.humanIntervention };
};

export const getAppToolCallPolicy = (
  identifier: string,
  toolName: string,
  { agentId, toolArgs = {} }: { agentId?: string; toolArgs?: Record<string, unknown> } = {},
): AppToolCallPolicy => {
  const tool = findToolIntervention(identifier, toolName, agentId);
  if (!tool) return 'deny';

  const userState = getUserStoreState();

  return resolveAppToolCallPolicy({
    allowList: toolInterventionSelectors.allowList(userState),
    approvalMode: toolInterventionSelectors.approvalMode(userState),
    intervention: tool.intervention,
    toolArgs,
    toolKey: `${identifier}/${toolName}`,
  });
};
