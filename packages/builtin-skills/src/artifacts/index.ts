import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';
import { ArtifactsIdentifier, ArtifactsManifest } from './manifest';

export { ArtifactsIdentifier };

/**  Superseded by Canvas (`lobe-canvas`); kept so existing conversations keep rendering. */
export const ArtifactsSkill: BuiltinSkill = {
  ...ArtifactsManifest,
  content: systemPrompt,
};
