import { isDesktop } from '@lobechat/const';
import type { OperationSkillSet } from '@lobechat/context-engine';
import { assembleSkillPool } from '@lobechat/mecha';
import debug from 'debug';

import { getToolStoreState } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/slices/agentSkills/selectors';
import { loadBuiltinSkills } from '@/store/tool/slices/builtin/loadBuiltinSkills';

const log = debug('context-engine:resolveClientSkills');

/** Only explicitly enabled skills appear, and their bodies load on activation. */
export const resolveClientSkills = async (
  pluginIds?: string[],
  disabledIds?: string[],
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
  const builtinMetas = (await loadBuiltinSkills()).map(({ identifier, description, name }) => ({
    description,
    identifier,
    name,
  }));
  const dbMetas = agentSkillsSelectors.getAgentSkills(toolState).map((s) => ({
    description: s.description ?? '',
    identifier: s.identifier,
    name: s.name,
  }));

  // Precedence, name dedupe and the device-only builtin gate are the shared
  // rules; the browser scans no project directory and mounts no
  // agent-document bundles, so it supplies two of the four sources.
  return assembleSkillPool(
    { builtin: builtinMetas, db: dbMetas },
    {
      // The desktop app is itself the execution device.
      canExecuteOnDevice: isDesktop,
      availableSkillIds: pluginIds,
      disabledIds,
    },
  );
};
