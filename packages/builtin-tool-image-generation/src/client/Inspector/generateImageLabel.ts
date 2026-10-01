import { AsyncTaskStatus } from '@lobechat/types';

import type { GenerateImageState } from '../../types';

export type GenerateImageLabelTense = 'completed' | 'loading' | 'neutral';

/**
 * The row stays in the chat history, so its tense must match what the canvas
 * below shows. A returned call is only "created" once every image succeeded —
 * a call that returned with images still in flight, or with a failed image,
 * falls back to the neutral action name instead of claiming completion.
 */
export const getGenerateImageLabelTense = (
  isRunning: boolean | undefined,
  pluginState?: Partial<GenerateImageState> | null,
): GenerateImageLabelTense => {
  if (isRunning) return 'loading';

  const generations = pluginState?.generations;
  if (!generations?.length) return 'neutral';

  return generations.every((task) => task.status === AsyncTaskStatus.Success)
    ? 'completed'
    : 'neutral';
};
