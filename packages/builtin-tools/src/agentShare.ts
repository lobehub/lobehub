import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import {
  type AgentPluginEntry,
  getActivePluginIds,
  getDisabledPluginIds,
  getOptedInPluginIds,
  type LobeAgentChatConfig,
  resolveToolMode,
} from '@lobechat/types';

import {
  AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS,
  alwaysOnToolIds,
  builtinTools,
  defaultToolIds,
  isAgentShareAllowedBuiltinIdentifier,
  isBuiltinToolIdentifier,
  isOnDemandBuiltinTool,
  runtimeManagedToolIds,
} from './index';

/**
 * Whether a share can grant `identifier` to visitors at all: the builtin
 * allowlist admits it and no data rule blocks it outright. Non-builtin
 * identifiers (MCP servers, connections, plugins) always pass; the creator's
 * grant alone governs them.
 */
export const isShareGrantableToolIdentifier = (identifier: string): boolean =>
  isAgentShareAllowedBuiltinIdentifier(identifier) &&
  !AGENT_SHARE_NO_DATA_GRANT_BUILTIN_IDENTIFIERS.has(identifier);

/**
 * Builtins the share picker always lists, whether or not the Agent pinned
 * them: the runtime-managed tools, plus Agent Documents, whose share grant
 * doubles as its runtime opt-in.
 */
export const runtimeManagedShareCandidateToolIds: string[] = [
  ...runtimeManagedToolIds,
  AgentDocumentsIdentifier,
].filter((identifier) => isShareGrantableToolIdentifier(identifier));

export interface ShareAgentToolSource {
  /**
   * The creator's connected extensions (MCP servers, connections, installed
   * plugins) the model could activate. In agent mode an extension with no
   * `plugins` entry is on (`getConnectorMode`), so every listed one counts
   * unless the Agent turned it off. Omitted, only opted-in extensions count.
   */
  activatableExtensionIds?: string[];
  chatConfig?: Pick<
    LobeAgentChatConfig,
    'enableAgentMode' | 'memory' | 'searchMode' | 'skillActivateMode' | 'toolMode'
  > | null;
  plugins?: AgentPluginEntry[];
  /**
   * The Agent's grantable skills. Pinning a skill writes its id into the same
   * `plugins` list, so these are subtracted: skills are granted through
   * `skillGrants`, never as tools.
   */
  skillIds?: string[];
}

/**
 * Tools the Agent's 工具与连接 page shows as turned off. Most record that as a
 * `disabled` plugin entry, but memory and web browsing are switched through
 * chatConfig instead (`memory.enabled`, `searchMode: 'off'`), so their plugin
 * list carries no entry.
 */
export const getShareTurnedOffToolIds = ({
  chatConfig,
  plugins,
}: Pick<ShareAgentToolSource, 'chatConfig' | 'plugins'>): string[] => [
  ...getDisabledPluginIds(plugins),
  ...(chatConfig?.memory?.enabled ? [] : [MemoryIdentifier]),
  ...((chatConfig?.searchMode || 'auto') === 'off' ? [WebBrowsingManifest.identifier] : []),
];

/**
 * The tools a visitor may use: pinned plugins plus the runtime-managed
 * builtins the picker always lists, minus skills.
 */
export const getShareToolCandidateIds = (pluginIds: string[], skillIds: string[] = []): string[] =>
  Array.from(new Set([...pluginIds, ...runtimeManagedShareCandidateToolIds])).filter(
    (toolId) => !skillIds.includes(toolId),
  );

/**
 * Tools the Agent's 工具与连接 page shows as turned on, limited to what a share
 * can grant. Both the share settings (default grants and the pending prompt)
 * and the server's automatic grants (`autoGrantAgentTools`) read this, so the
 * creator sees exactly what visitors get.
 *
 * - Pinned plugins and the runtime-managed builtins always count.
 * - On-demand tools count only in agent mode with automatic activation, the
 *   only mode with an activator: every on-demand builtin and every connected
 *   extension is on unless disabled. Without the connected list, an
 *   extension counts only when the Agent opted in.
 * - Everything the Agent turned off ({@link getShareTurnedOffToolIds}) is
 *   subtracted from both groups.
 *
 * Visitor-specific conditions (the memory permission, device-only MCP
 * servers) are left to the caller: the server gate already applies them to
 * every grant.
 */
export const getShareAgentEnabledToolIds = ({
  activatableExtensionIds,
  chatConfig,
  plugins,
  skillIds = [],
}: ShareAgentToolSource): string[] => {
  const turnedOff = new Set(getShareTurnedOffToolIds({ chatConfig, plugins }));
  const candidates = getShareToolCandidateIds(getActivePluginIds(plugins), skillIds);

  const onDemand: string[] = [];
  if (resolveToolMode(chatConfig) === 'agent' && chatConfig?.skillActivateMode !== 'manual') {
    const notOnDemand = new Set<string>([...alwaysOnToolIds, ...defaultToolIds, ...candidates]);
    const skills = new Set(skillIds);

    onDemand.push(
      ...builtinTools
        .filter((tool) => tool.discoverable !== false)
        .map((tool) => tool.identifier)
        .filter((identifier) => isOnDemandBuiltinTool(identifier) && !notOnDemand.has(identifier)),
      ...(activatableExtensionIds ?? getOptedInPluginIds(plugins)).filter(
        (identifier) =>
          !isBuiltinToolIdentifier(identifier) &&
          !skills.has(identifier) &&
          !notOnDemand.has(identifier),
      ),
    );
  }

  return [...new Set([...candidates, ...onDemand])].filter(
    (identifier) => !turnedOff.has(identifier) && isShareGrantableToolIdentifier(identifier),
  );
};
