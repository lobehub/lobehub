import { AgentBrowserIdentifier } from '@lobechat/builtin-skills';
import { isDesktop } from '@lobechat/const';
import { type BuiltinSkill } from '@lobechat/types';

export interface BuiltinSkillFilterContext {
  isDesktop: boolean;
}

const DESKTOP_ONLY_BUILTIN_SKILLS = new Set([AgentBrowserIdentifier]);

const DEFAULT_CONTEXT: BuiltinSkillFilterContext = {
  isDesktop,
};

const resolveBuiltinSkillFilterContext = (
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): BuiltinSkillFilterContext => ({
  isDesktop: context.isDesktop ?? DEFAULT_CONTEXT.isDesktop,
});

export const shouldEnableBuiltinSkill = (
  skillId: string,
  context: BuiltinSkillFilterContext = DEFAULT_CONTEXT,
): boolean => {
  const resolvedContext = resolveBuiltinSkillFilterContext(context);

  if (DESKTOP_ONLY_BUILTIN_SKILLS.has(skillId)) {
    if (!resolvedContext.isDesktop) return false;
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
