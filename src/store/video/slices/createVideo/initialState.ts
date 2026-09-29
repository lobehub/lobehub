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
  editingDraftSnapshot?: VideoEditingDraftSnapshot;
  editingGenerationId?: string;
  isCreating: boolean;
  isCreatingWithNewTopic: boolean;
}

export const initialCreateVideoState: CreateVideoState = {
  editingDraftSnapshot: undefined,
  editingGenerationId: undefined,
  isCreating: false,
  isCreatingWithNewTopic: false,
};
