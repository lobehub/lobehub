/**
 * Active label names are unique per scope (partial unique indexes that skip
 * archived rows), so the server answers a collision with CONFLICT /
 * `DUPLICATE_LABEL_NAME`. It reaches three flows: creating a label, renaming
 * one, and un-archiving one whose name has since been taken.
 */
export const isDuplicateLabelNameError = (error: any): boolean =>
  error?.data?.code === 'CONFLICT' || error?.message === 'DUPLICATE_LABEL_NAME';
