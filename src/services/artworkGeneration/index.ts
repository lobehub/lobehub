export { cutOutFlatBackground, type CutOutResult, type RgbaImage } from './cutOutFlatBackground';
export {
  type AttachedArtworkReferences,
  generateArtworkImage,
  type GenerateArtworkImageOptions,
} from './generateArtworkImage';
export { selectAgentArtworkModel } from './selectModel';
export { cutOutFullBodyArtwork } from './transparentFullBody';
export {
  generateWorkspaceAvatarImage,
  type GenerateWorkspaceAvatarImageOptions,
} from './workspaceAvatar';
// Re-exported so downstream consumers can type their style parameters without
// taking a direct dependency on `@lobechat/prompts`.
export type { AgentArtworkKind, AgentArtworkStyle } from '@lobechat/prompts';
