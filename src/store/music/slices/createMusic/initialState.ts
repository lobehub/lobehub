export interface CreateMusicState {
  /**
   * Prompt the last submit was rejected for by content moderation. The prompt
   * input shows an inline notice while its value still equals this prompt, so
   * editing the prompt dismisses it.
   */
  blockedPrompt?: string;
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
  /** Batches whose retry is in flight, so only their failed songs show a loading Retry */
  retryingBatchIds: string[];
}

export const initialCreateMusicState: CreateMusicState = {
  blockedPrompt: undefined,
  isCreating: false,
  isCreatingWithNewTopic: false,
  retryingBatchIds: [],
};
