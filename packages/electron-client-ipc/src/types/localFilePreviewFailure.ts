/** Terminal reasons a file preview failed. */
export type LocalFilePreviewFailureCode = 'forbidden' | 'not_found';

/** The failure half of a local file preview result. */
export interface LocalFilePreviewFailure {
  /**
   * Set when the failure is terminal for this file: `not_found` (deleted /
   * moved) or `forbidden` (outside the approved roots, permission denied).
   * Absent for transient failures, so a cached preview survives those.
   */
  code?: LocalFilePreviewFailureCode;
  error?: string;
}
