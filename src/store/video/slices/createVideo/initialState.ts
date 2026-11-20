import type { RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';

import type { VideoImageInputMode, VideoImageInputs } from '../generationConfig/imageInputMode';

export interface VideoEditingDraftSnapshot {
  imageInputMode: VideoImageInputMode;
  model: string;
  parameters: RuntimeVideoGenParams;
  parametersSchema: VideoModelParamsSchema;
  provider: string;
  stashedImageInputs: Partial<Record<VideoImageInputMode, VideoImageInputs>>;
  uploadingImagePreviews: string[];
}

export interface CreateVideoState {
  /**
   * Prompt the last submit was rejected for by content moderation. The prompt
   * input shows an inline notice while its value still equals this prompt, so
   * editing the prompt dismisses it.
   */
  blockedPrompt?: string;
  editingDraftSnapshot?: VideoEditingDraftSnapshot;
  editingGenerationId?: string;
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
}

export const initialCreateVideoState: CreateVideoState = {
  blockedPrompt: undefined,
  editingDraftSnapshot: undefined,
  editingGenerationId: undefined,
  isCreating: false,
  isCreatingWithNewTopic: false,
};
