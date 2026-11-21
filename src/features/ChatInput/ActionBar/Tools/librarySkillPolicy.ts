import {
  type AgentPluginEntry,
  type AgentPluginMode,
  getDisabledPluginIds,
  getLibrarySkillMode,
  LIBRARY_SKILL_IMPLICIT_MODE,
} from '@lobechat/types';

/**
 * Identifiers the Tools popover lists under Disabled: everything the agent
 * explicitly disabled, plus every library skill it has not turned on. A library
 * skill is opt-in per agent — the profile is where one is turned on — so having
 * no entry means off for it, where it means Auto for a tool or a builtin skill.
 */
export const resolveDisabledIds = (
  plugins: AgentPluginEntry[] | undefined,
  librarySkillIds: Iterable<string>,
): string[] => [
  ...new Set([
    ...getDisabledPluginIds(plugins),
    ...[...librarySkillIds].filter((id) => getLibrarySkillMode(plugins, id) === 'disabled'),
  ]),
];

/**
 * What `id` resolves to with no entry in the agent's plugins. Passed along with
 * a mode change so choosing Auto on a library skill writes an explicit entry
 * instead of removing it, which would turn the skill back off.
 */
export const resolveImplicitMode = (
  id: string,
  librarySkillIds: ReadonlySet<string>,
): AgentPluginMode => (librarySkillIds.has(id) ? LIBRARY_SKILL_IMPLICIT_MODE : 'auto');
