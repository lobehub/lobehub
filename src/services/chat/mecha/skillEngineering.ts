import { isDesktop } from '@lobechat/const';
import type { OperationSkillSet } from '@lobechat/context-engine';
import { assembleSkillPool } from '@lobechat/mecha';
import debug from 'debug';

import { getToolStoreState } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { loadBuiltinSkills } from '@/store/tool/slices/builtin/loadBuiltinSkills';

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
