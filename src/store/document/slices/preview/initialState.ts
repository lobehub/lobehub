/**
 * UI state for the global document preview modal.
 */
export interface PreviewState {
  /** ID of the document currently shown in the preview modal, if any. */
  previewDocumentId?: string;
}

export const initialPreviewState: PreviewState = {
  previewDocumentId: undefined,
};
