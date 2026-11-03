import type { BuiltinSkill } from '@lobechat/types';

import { AgentBrowserSkill } from './agent-browser';
import { ArtifactsSkill } from './artifacts';
import { LobeHubSkill } from './lobehub';
import { TaskSkill } from './task';

export { AgentBrowserIdentifier } from './agent-browser';
export { ArtifactsIdentifier } from './artifacts';
export { LobeHubIdentifier } from './lobehub';
export { TaskIdentifier } from './task';
export {
  buildReactArtifactProject,
  REACT_ARTIFACT_APP_PATH,
  REACT_ARTIFACT_BOOTSTRAP_PATH,
  REACT_ARTIFACT_DEFAULT_DEPENDENCIES,
  REACT_ARTIFACT_DEFAULT_DEV_DEPENDENCIES,
  REACT_ARTIFACT_ENTRY_PATH,
  REACT_ARTIFACT_EXTERNAL_RESOURCES,
  REACT_ARTIFACT_INDEX_HTML_PATH,
  REACT_ARTIFACT_PACKAGE_JSON_PATH,
  REACT_ARTIFACT_TAILWIND_CDN,
  REACT_ARTIFACT_VITE_ALIASES,
  REACT_ARTIFACT_VITE_CONFIG_PATH,
  type ReactArtifactProject,
  type ReactArtifactTemplateOptions,
  type ReactArtifactTemplateOverrides,
} from '@lobechat/artifact-template';

export const builtinSkills: BuiltinSkill[] = [
  AgentBrowserSkill,
  ArtifactsSkill,
  LobeHubSkill,
  TaskSkill,
  // FindSkillsSkill
];
