import { countVideoOutputTokens, type VideoGenerationUsage } from '@lobechat/model-runtime';

import type { VideoProcessResult } from './video';

/**
 * Usage of a video whose provider reports none but bills output tokens (fal Seedance 2.5): the
 * tokens follow the downloaded video's frame size and frame count, exactly what the provider bills.
 */
export const measureVideoOutputUsage = (
  model: string,
  { frames, height, width }: Pick<VideoProcessResult, 'frames' | 'height' | 'width'>,
): VideoGenerationUsage | undefined => {
  if (!frames) return undefined;

  const tokens = countVideoOutputTokens(model, { frames, height, width });
  return tokens === undefined ? undefined : { completionTokens: tokens, totalTokens: tokens };
};
