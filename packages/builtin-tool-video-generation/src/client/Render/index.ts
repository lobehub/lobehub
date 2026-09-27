import type { BuiltinRender } from '@lobechat/types';

import { VideoGenerationApiName } from '../../types';
import GenerateVideoRender from './GenerateVideo';
import GetVideoGenerationStatusRender from './GetVideoGenerationStatus';
import GetVideoModelParametersRender from './GetVideoModelParameters';
import ListVideoModelsRender from './ListVideoModels';

export const VideoGenerationRenders: Record<string, BuiltinRender> = {
  [VideoGenerationApiName.generateVideo]: GenerateVideoRender as BuiltinRender,
  [VideoGenerationApiName.getVideoGenerationStatus]:
    GetVideoGenerationStatusRender as BuiltinRender,
  [VideoGenerationApiName.getVideoModelParameters]: GetVideoModelParametersRender as BuiltinRender,
  [VideoGenerationApiName.listVideoModels]: ListVideoModelsRender as BuiltinRender,
};

export { default as GenerateVideoRender } from './GenerateVideo';
export { default as GetVideoGenerationStatusRender } from './GetVideoGenerationStatus';
export { default as GetVideoModelParametersRender } from './GetVideoModelParameters';
export { default as ListVideoModelsRender } from './ListVideoModels';
