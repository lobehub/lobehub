import {
  resolveUninstalledBuiltinTools,
  type UninstalledBuiltinToolsScope,
} from '@lobechat/builtin-tools';
import {
  getLegacyDisabledBuiltinSkillIds,
  legacyBuiltinSkillIds,
} from '@lobechat/mecha/builtinSkillGate';
import {
  type AgentPluginEntry,
  getBuiltinOverrides,
  getDisabledPluginIds,
  getLibrarySkillMode,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { UserModel } from '@/database/models/user';

import type { ToolExecutionContext } from '../types';

/**
 * Answers "may this run open this library (DB) skill". A library skill is
 * opt-in per agent, so one the agent has no entry for is off, not `auto`.
 *
 * `plugins` is the agent's own config, read fresh so a skill turned on (or
 * installed by the model) mid-run is reachable at once. `runSkillIds` is the
 * operation's skill pool: a turn's own selection or a share's grant puts a
 * skill there without the agent having turned it on, and the runtime must not
 * refuse what the pool already offered.
 *
 * `activateSkill` / `readReference` resolve a MODEL-SUPPLIED name fresh from
 * the DB, so leaving a skill out of `<available_skills>` is not enough on its
 * own — this is the check on that path.
 */
export const createLibrarySkillGate = (
  plugins: AgentPluginEntry[] | undefined,
  runSkillIds?: readonly string[],
): ((identifier: string) => boolean) => {
  const inRunPool = new Set(runSkillIds ?? []);
  return (identifier) =>
    getLibrarySkillMode(plugins, identifier) !== 'disabled' || inRunPool.has(identifier);
};

/** A failed settings read keeps previously uninstallable skills off unless this agent chose them. */
interface SkillUserSettings {
  market?: { accessToken?: string };
  tool?: UninstalledBuiltinToolsScope;
}

export const readSkillUserSettings = async (
  model: UserModel,
): Promise<SkillUserSettings | null> => {
  try {
    return ((await model.getUserSettings()) ?? {}) as SkillUserSettings;
  } catch {
    return null;
  }
};

/**
 * The run agent's own skill tri-state, re-derived for a runtime that resolves
 * skills fresh by name/id.
 *
 * Independent of `<available_skills>` (built once, at operation start): a model
 * that already knows a skill's name (prior turn, or a guess) could otherwise
 * still activate it. `disabledSkillIds` applies to every skill source;
 * `isLibrarySkillEnabled` only to library (DB) skills, and is absent when
 * there is no agent to opt in against, or for a share visitor — there the
 * creator's skill grant is the opt-in, by name.
 */
export const resolveAgentSkillGates = async (
  context: Pick<
    ToolExecutionContext,
    'agentId' | 'agentShareVisitor' | 'runSkillIds' | 'serverDB' | 'userId' | 'workspaceId'
  >,
  settings?: SkillUserSettings | null,
): Promise<{
  disabledSkillIds: Set<string>;
  isLibrarySkillEnabled?: (identifier: string) => boolean;
}> => {
  if (!context.agentId || !context.serverDB || !context.userId) {
    return { disabledSkillIds: new Set() };
  }

  const agentModel = new AgentModel(context.serverDB, context.userId, context.workspaceId);
  const [agentConfig, userSettings] = await Promise.all([
    agentModel.getAgentConfigById(context.agentId),
    settings === undefined && !context.agentShareVisitor
      ? readSkillUserSettings(new UserModel(context.serverDB, context.userId))
      : settings,
  ]);
  const plugins = agentConfig?.plugins ?? undefined;

  const legacyUninstalled = userSettings
    ? resolveUninstalledBuiltinTools(
        userSettings.tool,
        context.workspaceId ?? agentConfig?.workspaceId,
      )
    : legacyBuiltinSkillIds;

  return {
    disabledSkillIds: new Set([
      ...getDisabledPluginIds(plugins),
      ...getLegacyDisabledBuiltinSkillIds(
        context.agentShareVisitor ? [] : legacyUninstalled,
        getBuiltinOverrides(plugins),
      ),
    ]),
    isLibrarySkillEnabled: context.agentShareVisitor
      ? undefined
      : createLibrarySkillGate(plugins, context.runSkillIds),
  };
};
