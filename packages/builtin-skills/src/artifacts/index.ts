import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';
import { ArtifactsIdentifier, ArtifactsManifest } from './manifest';

export { ArtifactsIdentifier };

export const ArtifactsSkill: BuiltinSkill = {
  ...ArtifactsManifest,
  content: systemPrompt,
};
