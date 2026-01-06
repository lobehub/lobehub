import type { DocumentStore } from '../../store';

const isEditing = (s: DocumentStore) => !!s.activeDocumentId;

const isEditMode = (s: DocumentStore) => s.mode === 'edit';

const isPreviewMode = (s: DocumentStore) => s.mode === 'preview';

const canSave = (s: DocumentStore) => s.isDirty && s.saveStatus !== 'saving';

export const editorSelectors = {
  canSave,
  isEditMode,
  isEditing,
  isPreviewMode,
};
