export interface CreateImageState {
  /**
   * Prompt the last submit was rejected for by content moderation. The prompt
   * input shows an inline notice while its value still equals this prompt, so
   * editing the prompt dismisses it.
   */
  blockedPrompt?: string;
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
}

export const initialCreateImageState: CreateImageState = {
  blockedPrompt: undefined,
  isCreating: false,
  isCreatingWithNewTopic: false,
};
