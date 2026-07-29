import type { RuntimeVideoGenParams, VideoModelParamsSchema } from 'model-bank';

export interface VideoEditingDraftSnapshot {
  model: string;
  parameters: RuntimeVideoGenParams;
  parametersSchema: VideoModelParamsSchema;
  provider: string;
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
