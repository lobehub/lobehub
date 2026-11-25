import type { VideoStore } from '../../store';

// An edit exit restores completed creation inputs and invalidates the edit's uploads.
export const restoreEditingDraft = (state: VideoStore) => {
  const snapshot = state.editingDraftSnapshot;
  const clearedEdit = {
    blockedPrompt: undefined,
    editingDraftSnapshot: undefined,
    editingGenerationId: undefined,
    uploadingImagePreviews: [],
  };

  if (!snapshot) return clearedEdit;

  return {
    ...clearedEdit,
    imageInputMode: snapshot.imageInputMode,
    model: snapshot.model,
    parameters: snapshot.parameters,
    parametersSchema: snapshot.parametersSchema,
    provider: snapshot.provider,
    stashedImageInputs: snapshot.stashedImageInputs,
  };
};
