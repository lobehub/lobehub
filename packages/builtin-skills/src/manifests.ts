import type { BuiltinSkillManifest } from '@lobechat/types';

import { AgentBrowserManifest } from './agent-browser/manifest';
import { ArtifactsManifest } from './artifacts/manifest';
import { LobeHubManifest } from './lobehub/manifest';

export { AgentBrowserIdentifier } from './agent-browser/manifest';
export { ArtifactsIdentifier } from './artifacts/manifest';
export { LobeHubIdentifier } from './lobehub/manifest';

export const builtinSkillManifests: BuiltinSkillManifest[] = [
  AgentBrowserManifest,
  ArtifactsManifest,
  LobeHubManifest,
];
