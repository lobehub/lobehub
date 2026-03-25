import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';
import { FindSkillsSkill } from './find-skills';
import { LobeHubSkill } from './lobehub';
import { SkillCreatorSkill } from './skill-creator';

export { AgentBrowserIdentifier } from './agent-browser';
export { ArtifactsIdentifier } from './artifacts';
export { FindSkillsIdentifier } from './find-skills';
export { LobeHubIdentifier } from './lobehub';
export { SkillCreatorIdentifier } from './skill-creator';

export const builtinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  LobeHubSkill,
  FindSkillsSkill,
  SkillCreatorSkill,
];
