import type { BuiltinRender } from '@lobechat/types';

import { ImageGenerationApiName } from '../../types';
import GenerateImageRender from './GenerateImage';
import GetImageGenerationStatusRender from './GetImageGenerationStatus';

export const ImageGenerationRenders: Record<string, BuiltinRender> = {
  [ImageGenerationApiName.generateImage]: GenerateImageRender as BuiltinRender,
  [ImageGenerationApiName.getImageGenerationStatus]:
    GetImageGenerationStatusRender as BuiltinRender,
};

export { default as GenerateImageRender } from './GenerateImage';
export { default as GetImageGenerationStatusRender } from './GetImageGenerationStatus';
