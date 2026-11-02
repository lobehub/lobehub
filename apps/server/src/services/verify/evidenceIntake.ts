import type { VerifyEvidenceCapturedBy, VerifyEvidenceType } from '@lobechat/types';
import pMap from 'p-map';

import type { FileModel } from '@/database/models/file';

import { evidenceTypeForStoredFile } from './evidenceMedium';
import { resolveEvidenceMetadata } from './terminalEvidence';

/** One evidence entry as a caller submits it — before its medium and metadata are trusted. */
export interface IncomingEvidence {
  capturedBy?: VerifyEvidenceCapturedBy;
  content?: string;
  description?: string;
  fileId?: string;
  metadata?: unknown;
  type: VerifyEvidenceType;
}

/** Entries of one submission resolved at a time (a file lookup and a record check each). */
const RESOLVE_CONCURRENCY = 5;

/** Store a file-backed artifact under the medium of the file itself, not the caller's label. */
const storedEvidenceType = async (
  fileModel: Pick<FileModel, 'findById'>,
  type: VerifyEvidenceType,
  fileId?: string | null,
): Promise<VerifyEvidenceType> =>
  fileId ? evidenceTypeForStoredFile(type, await fileModel.findById(fileId)) : type;

/**
 * Turn submitted evidence into rows ready to insert, missing only the check
 * result they back. Every entry is resolved before the caller writes anything:
 * a rejected terminal record must fail the whole submission, not leave a
 * verdict behind without the evidence that was meant to back it. File lookups
 * are owner-scoped through `fileModel`, so a record can only bind the caller's
 * own artifacts.
 */
export const prepareEvidenceRows = (
  fileModel: Pick<FileModel, 'findById'>,
  entries: IncomingEvidence[],
) =>
  pMap(
    entries,
    async (entry) => {
      const type = await storedEvidenceType(fileModel, entry.type, entry.fileId);
      const metadata = await resolveEvidenceMetadata(
        (fileId) => fileModel.findById(fileId),
        type,
        entry.metadata,
      );
      return {
        capturedAt: new Date(),
        capturedBy: entry.capturedBy ?? null,
        content: entry.content ?? null,
        description: entry.description ?? null,
        fileId: entry.fileId ?? null,
        metadata: metadata ?? null,
        type,
      };
    },
    { concurrency: RESOLVE_CONCURRENCY },
  );
