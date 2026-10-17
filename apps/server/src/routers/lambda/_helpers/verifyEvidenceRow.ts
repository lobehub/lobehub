import { normalizeEvidenceMetadata } from '@lobechat/const/verify';
import type { VerifyEvidenceCapturedBy, VerifyEvidenceType } from '@lobechat/types';

import type { FileModel } from '@/database/models/file';
import type { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { evidenceTypeForStoredFile } from '@/server/services/verify';

export interface VerifyEvidenceRowInput {
  capturedBy?: VerifyEvidenceCapturedBy | null;
  content?: string | null;
  description?: string | null;
  fileId?: string | null;
  metadata?: unknown;
  type: VerifyEvidenceType;
}

/**
 * Store one evidence artifact on a check result — the single write path behind
 * `uploadEvidence` and `submitCheckEvidence`. A file-backed artifact is stored
 * under the medium of the file itself, not the caller's label, and its metadata
 * (a video's chapters, a comparison pair) is normalized for that medium.
 */
export const createVerifyEvidenceRow = async (
  ctx: { evidenceModel: VerifyEvidenceModel; fileModel: FileModel },
  checkResultId: string,
  input: VerifyEvidenceRowInput,
) => {
  const type = input.fileId
    ? evidenceTypeForStoredFile(input.type, await ctx.fileModel.findById(input.fileId))
    : input.type;

  return ctx.evidenceModel.create({
    capturedAt: new Date(),
    capturedBy: input.capturedBy ?? null,
    checkResultId,
    content: input.content ?? null,
    description: input.description ?? null,
    fileId: input.fileId ?? null,
    metadata: normalizeEvidenceMetadata(input.metadata, type) ?? null,
    type,
  });
};
