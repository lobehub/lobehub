import type { DocumentWriteSource } from '@lobechat/types';

export interface CheckDocumentCharLimitParams {
  /** Length the document would have after the write, in UTF-16 code units. */
  charCount: number;
  source: DocumentWriteSource;
  userId: string;
  workspaceId?: string | null;
}

export type CheckDocumentCharLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      limit: number;
      /** Plan the limit comes from, shown to the user and the model. */
      plan?: string;
    };

/**
 * Decides whether a document may grow to `charCount` characters. The default
 * never limits; a deployment with per-document size limits overrides it.
 */
export const checkDocumentCharLimit = async (
  _params: CheckDocumentCharLimitParams,
): Promise<CheckDocumentCharLimitResult> => ({ allowed: true });
