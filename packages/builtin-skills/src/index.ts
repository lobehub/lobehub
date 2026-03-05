import { isDesktop } from '@lobechat/const';
import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';

const shouldEnableBuiltinSkill = (identifier: string): boolean => {
  if (identifier === AgentBrowserSkill.identifier) {
    return isDesktop;
  }

  return true;
};

const allBuiltinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  // FindSkillsSkill
];

export const builtinSkills: BuiltinSkill[] = allBuiltinSkills.filter((skill) =>
  shouldEnableBuiltinSkill(skill.identifier),
);
