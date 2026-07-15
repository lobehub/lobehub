import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

export interface EvidenceFileMeta {
  fileName: string | null;
  fileUrl: string | null;
}

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
    if (!fileId) return { fileName: null, fileUrl: null };

    try {
      const file = await FileModel.getFileById(db, fileId);
      if (!file) return { fileName: null, fileUrl: null };
      if (!file.url) return { fileName: file.name ?? null, fileUrl: null };

      const service = getFileService();
      if (!service) return { fileName: file.name ?? null, fileUrl: null };

      try {
        return { fileName: file.name ?? null, fileUrl: await service.getFullFileUrl(file.url) };
      } catch (error) {
        console.error('[verify:getReportBundle:resolveFileMeta]', error);
        return { fileName: file.name ?? null, fileUrl: null };
      }
    } catch (error) {
      console.error('[verify:getReportBundle:resolveFileMeta]', error);
      return { fileName: null, fileUrl: null };
    }
  };
};
