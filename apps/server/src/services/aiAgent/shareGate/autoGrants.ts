import {
  getShareAgentEnabledToolIds,
  type ShareAgentToolSource,
} from '@lobechat/builtin-tools/agentShare';
import { resolveShareToolGrants } from '@lobechat/const';
import { type AgentPluginEntry, getActivePluginIds, getOptedInPluginIds } from '@lobechat/types';

import type { AgentShareConfig } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { listShareActivatableExtensionIds } from '@/server/services/agentShare/activatableExtensions';
import { listShareGrantableSkills } from '@/server/services/agentShare/grantableSkills';

import type { AgentShareGate } from './types';

/**
 * `shareConfig` with `autoGrantAgentTools` resolved into plain grants: every
 * tool the Agent turns on and every skill it can load, minus what the creator
 * declined. An identifier that already has an explicit grant keeps it, so a
 * grant narrowed to some APIs is never widened.
 *
 * Returns `shareConfig` unchanged when the switch is off.
 */
export const applyShareAutoAgentGrants = <T extends AgentShareConfig>(
  shareConfig: T,
  agent: Pick<ShareAgentToolSource, 'activatableExtensionIds' | 'chatConfig' | 'plugins'> & {
    skillIds: string[];
  },
): T => {
  if (!shareConfig.autoGrantAgentTools) return shareConfig;

  const declined = new Set(shareConfig.declinedGrantIds ?? []);
  const toolGrants = shareConfig.toolGrants ?? [];
  const granted = resolveShareToolGrants(toolGrants);
  const skillGrants = shareConfig.skillGrants ?? [];
  const grantedSkills = new Set(skillGrants);

  return {
    ...shareConfig,
    skillGrants: [
      ...skillGrants,
      ...agent.skillIds.filter((id) => !grantedSkills.has(id) && !declined.has(id)),
    ],
    toolGrants: [
      ...toolGrants,
      ...getShareAgentEnabledToolIds(agent)
        .filter((id) => !granted.has(id) && !declined.has(id))
        .map((identifier) => ({ identifier })),
    ],
  };
};

/**
 * The run's resolved config collapses `plugins` to pinned ids, so the `auto`
 * and `disabled` entries the shared rule reads are rebuilt from what the
 * pipeline captured off the row before that collapse.
 */
const toPluginEntries = ({
  autoSkillIds,
  disabledPluginIds,
  plugins,
}: ShareAutoGrantAgent): AgentPluginEntry[] => {
  const pinnedPluginIds = getActivePluginIds(plugins);
  const pinned = new Set(pinnedPluginIds);
  return [
    ...pinnedPluginIds,
    ...autoSkillIds
      .filter((identifier) => !pinned.has(identifier))
      .map((identifier) => ({ identifier, mode: 'auto' as const })),
    ...disabledPluginIds.map((identifier) => ({ identifier, mode: 'disabled' as const })),
  ];
};

/** The run's Agent, as the pipeline holds it after resolving its config. */
export interface ShareAutoGrantAgent {
  /** `auto` plugin entries, captured before the pinned-id collapse. */
  autoSkillIds: string[];
  chatConfig?: ShareAgentToolSource['chatConfig'];
  /** `disabled` plugin entries, captured before the pinned-id collapse. */
  disabledPluginIds: string[];
  /** The resolved config's `plugins`, already collapsed to pinned ids. */
  plugins?: AgentPluginEntry[];
}

/**
 * The gate a visitor run executes under, with `autoGrantAgentTools` resolved
 * against the run's own Agent config.
 *
 * Resolved once, right after the Agent config and before anything reads the
 * grants (tool discovery, the tool-set gate, the skill pool, the dispatch-time
 * marker), so every layer sees the same grants. Nothing is written back: a
 * tool the Agent turns on later is granted on its next run, and one it turns
 * off is gone from the next run.
 */
export const resolveShareAutoAgentGrants = async (
  gate: AgentShareGate,
  {
    agent,
    db,
    listLobehubSkillProviderIds,
    userId,
    workspaceId,
  }: {
    agent: ShareAutoGrantAgent;
    db: LobeChatDatabase;
    /** The creator's LobeHub connections, which only the Market knows. */
    listLobehubSkillProviderIds?: () => Promise<string[]>;
    userId: string;
    workspaceId?: string;
  },
): Promise<AgentShareGate> => {
  if (!gate.shareConfig.autoGrantAgentTools) return gate;

  const plugins = toPluginEntries(agent);
  const [skills, connectedExtensionIds] = await Promise.all([
    listShareGrantableSkills({
      agentConfig: { chatConfig: agent.chatConfig, plugins },
      agentId: gate.agentId,
      canExecuteOnDevice: gate.canUseDevice,
      db,
      userId,
      workspaceId,
    }),
    listShareActivatableExtensionIds({
      agentId: gate.agentId,
      db,
      listLobehubSkillProviderIds,
      userId,
      workspaceId,
    }),
  ]);

  return {
    ...gate,
    shareConfig: applyShareAutoAgentGrants(gate.shareConfig, {
      // An opted-in extension still counts when its source was not listed
      // (say the Market lookup failed); the run's tool set drops a missing one.
      activatableExtensionIds: [...connectedExtensionIds, ...getOptedInPluginIds(plugins)],
      chatConfig: agent.chatConfig,
      plugins,
      skillIds: skills.map((skill) => skill.identifier),
    }),
  };
};
