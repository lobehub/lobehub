import { LobeHubIdentifier } from '@lobechat/builtin-skills/manifests';
import { getUserDisabledToolIds } from '@lobechat/builtin-tools';
import { isDesktop } from '@lobechat/const';
import type { OperationSkillSet } from '@lobechat/context-engine';
import { mentionsTopic } from '@lobechat/context-engine';
import { assembleSkillPool, type ResolvedAgentConfig } from '@lobechat/mecha';
import { getAutoPluginIds, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';

import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { collectSelectedSkillIds } from '@/store/chat/slices/agentRun/actions/entries/commandBus/parseCommands';
import { getToolStoreState } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { loadBuiltinSkills } from '@/store/tool/slices/builtin/loadBuiltinSkills';
import {
  confirmedUninstalledBuiltinTools,
  installedImplicitBuiltinSkillIds,
  legacyDisabledBuiltinSkillsForRun,
} from '@/store/tool/slices/builtin/projection';

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
 * Whether a client-side run has any skill to offer, for deciding if the skill
 * APIs of `lobe-skills` can be left out of its first request.
 *
 * Answers from the run's own resolved agent config, so it reads the same
 * plugins and chat config the run does, and from the same agent profile the
 * context build uses for implicit builtin skills. The context build removes
 * more from its pool than this does (unavailable builtins, switched-off
 * connectors), so where the two differ this one errs towards keeping the
 * skill APIs loaded.
 *
 * Returns `undefined` when the installed skill list could not be confirmed
 * with the server, which must not be read as "no skills".
 */
export const resolveClientRunHasSkills = async ({
  agentConfig,
  agentId,
  messages,
}: {
  agentConfig: Pick<ResolvedAgentConfig, 'agentConfig' | 'chatConfig' | 'plugins'>;
  /** The agent the context build reads its profile from (`ClientContextBuilder`). */
  agentId?: string;
  messages: UIChatMessage[];
}): Promise<boolean | undefined> => {
  // A skill picked with `/` is injected into the user message and is callable
  // even when the agent has not opted into it, so it never reaches the pool.
  if (collectSelectedSkillIds(messages).length > 0) return true;

  const { chatConfig } = agentConfig;
  const rawPlugins = agentConfig.agentConfig?.plugins;
  const agentItem = agentId
    ? agentByIdSelectors.getAgentById(agentId)(getAgentStoreState())
    : undefined;

  const { skills } = await resolveClientSkills(
    agentConfig.plugins ?? [],
    [
      ...getUserDisabledToolIds(rawPlugins, chatConfig),
      ...legacyDisabledBuiltinSkillsForRun(getToolStoreState(), rawPlugins),
    ],
    chatConfig?.skillActivateMode,
    mentionsTopic(messages) ? [LobeHubIdentifier] : undefined,
    getAutoPluginIds(rawPlugins),
    installedImplicitBuiltinSkillIds(getToolStoreState(), agentItem?.createdAt, chatConfig),
  );
  if (skills.length > 0) return true;

  // An empty pool only counts once the server confirmed both lists it is built
  // from: `resolveClientSkills` falls back to whatever the store holds when the
  // installed skills fail to load, and implicit builtin skills are withheld
  // until the uninstall list is confirmed.
  const toolState = getToolStoreState();
  if (
    !agentSkillsSelectors.isAgentSkillListSynced(toolState) ||
    !confirmedUninstalledBuiltinTools(toolState)
  ) {
    log('Skill lists are not confirmed by the server; keeping lobe-skills loaded');
    return undefined;
  }

  return false;
};
