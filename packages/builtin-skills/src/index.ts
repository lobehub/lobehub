import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';

export { AgentBrowserIdentifier } from './agent-browser';
export { ArtifactsIdentifier } from './artifacts';

export const builtinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  // FindSkillsSkill
];
