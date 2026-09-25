import type { BuiltinStreaming } from '@lobechat/types';

import { ImageGenerationApiName } from '../../types';
import GenerateImageStreaming from './GenerateImage';

// Registered as a Streaming (not a Placeholder) on purpose: the tool detail only
// consults Placeholders once a result message exists, while a Streaming renderer
// also covers the argument-streaming phase — and image generation has no
// perceivable state in between worth a second component.
export const ImageGenerationStreamings: Record<string, BuiltinStreaming> = {
  [ImageGenerationApiName.generateImage]: GenerateImageStreaming as BuiltinStreaming,
};

export { default as GenerateImageStreaming } from './GenerateImage';
