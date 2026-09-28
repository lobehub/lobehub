import type { BuiltinPlaceholder } from '@lobechat/types';

import { VideoGenerationApiName } from '../../types';
import { GenerateVideoPlaceholder } from './GenerateVideo';

export const VideoGenerationPlaceholders: Record<string, BuiltinPlaceholder> = {
  [VideoGenerationApiName.generateVideo]: GenerateVideoPlaceholder as BuiltinPlaceholder,
};

export { GenerateVideoPlaceholder };
