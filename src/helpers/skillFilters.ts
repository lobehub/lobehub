import { AgentBrowserIdentifier } from '@lobechat/builtin-skills';
import { isDesktop } from '@lobechat/const';
import { type BuiltinSkill } from '@lobechat/types';

export interface BuiltinSkillFilterContext {
  isDesktop: boolean;
  isWindows?: boolean;
}

const DESKTOP_ONLY_BUILTIN_SKILLS = new Set([AgentBrowserIdentifier]);

/** Agent Browser is hidden on Windows (not yet fully supported) */
const WINDOWS_HIDDEN_BUILTIN_SKILLS = new Set([AgentBrowserIdentifier]);

const getIsWindows = (): boolean => {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }
  if (typeof window !== 'undefined' && window.lobeEnv?.platform) {
    return window.lobeEnv.platform === 'win32';
  }
  return false;
};

const DEFAULT_CONTEXT: BuiltinSkillFilterContext = {
  isDesktop,
  isWindows: getIsWindows(),
};

const resolveBuiltinSkillFilterContext = (
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkillFilterContext => ({
  isDesktop: context.isDesktop ?? DEFAULT_CONTEXT.isDesktop,
  isWindows: context.isWindows ?? DEFAULT_CONTEXT.isWindows,
});

export const shouldEnableBuiltinSkill = (
  skillId: string,
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): boolean => {
  const resolvedContext = resolveBuiltinSkillFilterContext(context);

  if (DESKTOP_ONLY_BUILTIN_SKILLS.has(skillId)) {
    if (!resolvedContext.isDesktop) return false;
    if (WINDOWS_HIDDEN_BUILTIN_SKILLS.has(skillId) && resolvedContext.isWindows) return false;
    return true;
  }

  return true;
};

export const filterBuiltinSkills = (
  skills: BuiltinSkill[],
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkill[] => {
  return skills.filter((skill) => shouldEnableBuiltinSkill(skill.identifier, context));
};
