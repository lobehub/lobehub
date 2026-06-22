import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';
import { LobeHubSkill } from './lobehub';
import { TaskSkill } from './task';

export { AgentBrowserIdentifier } from './agent-browser';
export { ArtifactsIdentifier } from './artifacts';
export { LobeHubIdentifier } from './lobehub';
export { TaskIdentifier } from './task';

/**
 * The portable verify skill is distributed to external builders (Claude Code /
 * Codex) by pulling it to disk (`lh verify init`), NOT by loading it into the
 * homogeneous agent runtime. So it is exported as a named skill for the pull
 * endpoint to import directly, but deliberately left OUT of `builtinSkills`
 * below — keeping it out of every app-layer consumer of that array (server
 * runtime, agentDocumentVfs, tool store / picker).
 */
export { VerifyIdentifier, VerifySkill } from './verify';

export const builtinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  LobeHubSkill,
  TaskSkill,
  // FindSkillsSkill
];
