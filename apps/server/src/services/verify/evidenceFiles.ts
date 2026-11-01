import {
  readTerminalEvidenceMetadata,
  TERMINAL_ARTIFACT_KEYS,
  type TerminalArtifactKey,
} from '@lobechat/utils/verify/terminalEvidence';

import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

export interface EvidenceFileMeta {
  /** Intrinsic image height (px) from the upload's stored metadata, when known. */
  fileHeight: number | null;
  fileName: string | null;
  fileUrl: string | null;
  /** Intrinsic image width (px) — lets the client reserve the aspect ratio
      before the image loads, so expanding a row never jumps in height. */
  fileWidth: number | null;
}

const dimension = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/**
 * Display metadata for file-backed evidence artifacts (name + full/signed URL).
 *
 * Every failure degrades to nulls instead of throwing: a report/bundle must
 * still render when one screenshot's storage row is gone. The `FileService` is
 * built lazily and once — constructing it can itself throw (storage env), and a
 * bundle resolves dozens of artifacts.
 */
export const createEvidenceFileResolver = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
) => {
  let fileService: FileService | null | undefined;
  const getFileService = () => {
    if (fileService !== undefined) return fileService;

    try {
      fileService = new FileService(db, userId, workspaceId);
    } catch (error) {
      console.error('[verify:getReportBundle:resolveFileMeta]', error);
      fileService = null;
    }

    return fileService;
  };

  return async (fileId: string | null): Promise<EvidenceFileMeta> => {
    const empty: EvidenceFileMeta = {
      fileHeight: null,
      fileName: null,
      fileUrl: null,
      fileWidth: null,
    };
    if (!fileId) return empty;

    try {
      const file = await FileModel.getFileById(db, fileId);
      if (!file) return empty;

      const metadata = file.metadata as { height?: unknown; width?: unknown } | null;
      const base: EvidenceFileMeta = {
        fileHeight: dimension(metadata?.height),
        fileName: file.name ?? null,
        fileUrl: null,
        fileWidth: dimension(metadata?.width),
      };
      if (!file.url) return base;

      const service = getFileService();
      if (!service) return base;

      try {
        return { ...base, fileUrl: await service.getFullFileUrl(file.url) };
      } catch (error) {
        console.error('[verify:getReportBundle:resolveFileMeta]', error);
        return base;
      }
    } catch (error) {
      console.error('[verify:getReportBundle:resolveFileMeta]', error);
      return empty;
    }
  };
};

/** A terminal evidence artifact as the page loads it: a signed URL in place of the file id. */
export interface TerminalArtifactLink {
  fileUrl: string | null;
  sha256: string;
  size: number;
}

/**
 * Display metadata for an evidence row: its own file, plus — for a `terminal`
 * evidence — signed URLs for the stdout / stderr / output / recording files
 * its record references. Unknown or invalid records resolve to no artifacts,
 * and the page falls back to the row's text payload.
 */
export const resolveEvidenceFiles = async <
  T extends { fileId?: string | null; metadata?: unknown; type: string },
>(
  resolveFileMeta: (fileId: string | null) => Promise<EvidenceFileMeta>,
  evidence: T,
): Promise<
  T &
    EvidenceFileMeta & {
      terminalArtifacts?: Partial<Record<TerminalArtifactKey, TerminalArtifactLink>>;
    }
> => {
  const meta = await resolveFileMeta(evidence.fileId ?? null);
  if (evidence.type !== 'terminal') return { ...evidence, ...meta };

  const terminal = readTerminalEvidenceMetadata(evidence.metadata);
  if (!terminal) return { ...evidence, ...meta };

  const entries = await Promise.all(
    TERMINAL_ARTIFACT_KEYS.map(async (key) => {
      const artifact = terminal.artifacts[key];
      if (!artifact?.fileId) return null;
      const file = await resolveFileMeta(artifact.fileId);
      return [
        key,
        { fileUrl: file.fileUrl, sha256: artifact.sha256, size: artifact.size },
      ] as const;
    }),
  );
  return {
    ...evidence,
    ...meta,
    terminalArtifacts: Object.fromEntries(entries.filter((entry) => entry !== null)),
  };
};
