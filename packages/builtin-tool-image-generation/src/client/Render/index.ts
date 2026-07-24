import type { BuiltinRender } from '@lobechat/types';

import { ImageGenerationApiName } from '../../types';
import GenerateImageRender from './GenerateImage';
import GetImageGenerationStatusRender from './GetImageGenerationStatus';
import GetImageModelParametersRender from './GetImageModelParameters';
import ListImageModelsRender from './ListImageModels';

export const ImageGenerationRenders: Record<string, BuiltinRender> = {
  [ImageGenerationApiName.generateImage]: GenerateImageRender as BuiltinRender,
  [ImageGenerationApiName.getImageGenerationStatus]:
    GetImageGenerationStatusRender as BuiltinRender,
  [ImageGenerationApiName.getImageModelParameters]: GetImageModelParametersRender as BuiltinRender,
  [ImageGenerationApiName.listImageModels]: ListImageModelsRender as BuiltinRender,
};

export { default as GenerateImageRender } from './GenerateImage';
export { default as GetImageGenerationStatusRender } from './GetImageGenerationStatus';
export { default as GetImageModelParametersRender } from './GetImageModelParameters';
export { default as ListImageModelsRender } from './ListImageModels';
