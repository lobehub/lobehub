import type { VideoStore } from '../../store';

// An edit exit restores completed creation inputs and invalidates the edit's uploads.
export const restoreEditingDraft = (state: VideoStore) => {
  const snapshot = state.editingDraftSnapshot;

  if (!snapshot) {
    return {
      editingDraftSnapshot: undefined,
      editingGenerationId: undefined,
      uploadingImagePreviews: [],
    };
  }

  return {
    editingDraftSnapshot: undefined,
    editingGenerationId: undefined,
    imageInputMode: snapshot.imageInputMode,
    model: snapshot.model,
    parameters: snapshot.parameters,
    parametersSchema: snapshot.parametersSchema,
    provider: snapshot.provider,
    stashedImageInputs: snapshot.stashedImageInputs,
    uploadingImagePreviews: [],
  };
};
