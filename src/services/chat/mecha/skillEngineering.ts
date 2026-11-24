import { hasHistoricalToolInvocation } from '@lobechat/agent-runtime';
import { LobeHubIdentifier } from '@lobechat/builtin-skills/manifests';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { getUserDisabledToolIds } from '@lobechat/builtin-tools';
import { isDesktop, resolveSubAgentChatConfig } from '@lobechat/const';
import type { OperationSkillSet } from '@lobechat/context-engine';
import { mentionsTopic } from '@lobechat/context-engine';
import { assembleSkillPool } from '@lobechat/mecha';
import {
  getAutoPluginIds,
  type LobeAgentChatConfig,
  resolveToolMode,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';

import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getToolStoreState } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { loadBuiltinSkills } from '@/store/tool/slices/builtin/loadBuiltinSkills';
import {
  installedImplicitBuiltinSkillIds,
  legacyDisabledBuiltinSkillsForRun,
} from '@/store/tool/slices/builtin/projection';

import { resolveAgentConfig } from './agentConfigResolver';

const log = debug('context-engine:resolveClientSkills');

/** Build the discoverable catalog without fetching any skill bodies. */
export const resolveClientSkills = async (
  pluginIds?: string[],
  disabledIds?: string[],
  skillActivateMode?: 'auto' | 'manual',
  /** Selectable for this turn even in manual mode, without being pinned. */
  turnSkillIds?: string[],
  /**
   * Library skills the agent set to `auto`. A library skill is opt-in per
   * agent: one that is neither here nor pinned is not listed at all.
   */
  autoSkillIds?: string[],
  implicitBuiltinSkillIds?: readonly string[],
): Promise<OperationSkillSet> => {
  // The list is only fetched by mounted views (tool popover, side panel), so a
  // send right after a page load would otherwise see no DB skills. A failed
  // load must not block the send; fall back to whatever the store holds.
  try {
    await getToolStoreState().ensureAgentSkillsLoaded();
  } catch (error) {
    log('Failed to load agent skills before building the skill pool: %O', error);
  }

  const toolState = getToolStoreState();
  const builtinMetas = (await loadBuiltinSkills()).map(({ description, identifier, name }) => ({
    description,
    identifier,
    name,
  }));
  const dbMetas = agentSkillsSelectors.getAgentSkills(toolState).map((skill) => ({
    description: skill.description ?? '',
    identifier: skill.identifier,
    name: skill.name,
  }));

  // Precedence, name dedupe and the device-only builtin gate are the shared
  // rules; the browser scans no project directory and mounts no
  // agent-document bundles, so it supplies two of the four sources.
  return assembleSkillPool(
    { builtin: builtinMetas, db: dbMetas },
    {
      autoSkillIds,
      disabledIds,
      implicitBuiltinSkillIds,
      // The desktop app is itself the execution device.
      canExecuteOnDevice: isDesktop,
      enabledPluginIds: pluginIds,
      skillActivateMode,
      turnSkillIds,
    },
  );
};

/**
 * Determine whether a client-side Agent-mode run has any skills available (or
 * prior `lobe-skills` invocations in history) so `lobe-skills` can be deferred
 * on 0-skill turns without dropping historical replay or selected skills.
 */
export const resolveClientRunHasSkills = async ({
  agentId,
  chatConfigOverride,
  disableTools,
  groupId,
  isSubAgent,
  messages,
  scope,
  selectedSkillsCount = 0,
}: {
  agentId?: string;
  chatConfigOverride?: Partial<LobeAgentChatConfig> | null;
  disableTools?: boolean;
  groupId?: string;
  isSubAgent?: boolean;
  messages: UIChatMessage[];
  scope?: string;
  selectedSkillsCount?: number;
}): Promise<boolean | undefined> => {
  if (disableTools) return undefined;
  if (selectedSkillsCount > 0 || hasHistoricalToolInvocation(messages, SkillsIdentifier)) {
    return true;
  }

  const resolved = resolveAgentConfig({
    agentId: agentId || '',
    disableTools,
    groupId,
    isSubAgent,
    scope: scope as any,
  });
  const chatConfig = chatConfigOverride
    ? (resolveSubAgentChatConfig(resolved.chatConfig, chatConfigOverride) ?? resolved.chatConfig)
    : resolved.chatConfig;
  if (resolveToolMode(chatConfig) !== 'agent') return undefined;

  const rawPlugins = resolved.agentConfig?.plugins;
  const agentItem = agentId
    ? agentByIdSelectors.getAgentById(agentId)(getAgentStoreState())
    : undefined;
  const toolState = getToolStoreState();
  try {
    await toolState.ensureAgentSkillsLoaded();
  } catch {
    // Couldn't verify the installed skill list from the server; avoid deferring lobe-skills.
    return undefined;
  }

  const { skills } = await resolveClientSkills(
    resolved.plugins ?? [],
    [
      ...getUserDisabledToolIds(rawPlugins, chatConfig),
      ...legacyDisabledBuiltinSkillsForRun(toolState, rawPlugins),
    ],
    chatConfig?.skillActivateMode,
    mentionsTopic(messages) ? [LobeHubIdentifier] : undefined,
    getAutoPluginIds(rawPlugins),
    installedImplicitBuiltinSkillIds(toolState, agentItem?.createdAt, chatConfig),
  );

  return skills.length > 0;
};
