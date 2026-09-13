import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { AcceptanceModel } from '@/database/models/acceptance';
import { FileModel } from '@/database/models/file';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { files } from '@/database/schemas/file';
import { verifyCheckResults, verifyEvidence, verifyRuns } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import type { FileService } from '@/server/services/file';

export interface PurgePreview {
  bytes: number;
  fileCount: number;
  files: { images: number; other: number; videos: number };
  rounds: number;
}

const listRunIds = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  acceptanceId: string,
) => {
  const rows = await db
    .select({ id: verifyRuns.id })
    .from(verifyRuns)
    .where(
      and(
        eq(verifyRuns.acceptanceId, acceptanceId),
        buildWorkspaceWhere({ userId, workspaceId }, verifyRuns),
      ),
    );
  return rows.map((row) => row.id);
};

const listEvidenceFileIds = async (db: LobeChatDatabase, runIds: string[]) => {
  if (runIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ fileId: verifyEvidence.fileId })
    .from(verifyEvidence)
    .innerJoin(verifyCheckResults, eq(verifyCheckResults.id, verifyEvidence.checkResultId))
    .where(and(inArray(verifyCheckResults.verifyRunId, runIds), isNotNull(verifyEvidence.fileId)));
  return rows.map((row) => row.fileId!);
};

const purgeFiles = async (
  db: LobeChatDatabase,
  fileService: FileService,
  userId: string,
  workspaceId: string | undefined,
  fileIds: string[],
) => {
  if (fileIds.length === 0) return 0;
  const owned = await db
    .select({ id: files.id })
    .from(files)
    .where(and(inArray(files.id, fileIds), buildWorkspaceWhere({ userId, workspaceId }, files)));
  if (owned.length === 0) return 0;
  const unreferenced = await new FileModel(db, userId, workspaceId).deleteMany(
    owned.map((file) => file.id),
    true,
  );
  const urls = [...new Set(unreferenced.map((file) => file.url))];
  if (urls.length > 0) await fileService.deleteFiles(urls);
  return owned.length;
};

export const previewAcceptancePurge = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  acceptanceId: string,
): Promise<PurgePreview> => {
  const runIds = await listRunIds(db, userId, workspaceId, acceptanceId);
  const fileIds = await listEvidenceFileIds(db, runIds);
  const empty = { bytes: 0, fileCount: 0, files: { images: 0, other: 0, videos: 0 } };
  if (fileIds.length === 0) return { ...empty, rounds: runIds.length };

  const rows = await db
    .select({
      fileHash: files.fileHash,
      fileType: files.fileType,
      id: files.id,
      size: files.size,
    })
    .from(files)
    .where(and(inArray(files.id, fileIds), buildWorkspaceWhere({ userId, workspaceId }, files)));

  const maxSizeByObject = new Map<string, number>();
  const counts = { ...empty.files };
  for (const row of rows) {
    const key = row.fileHash ?? row.id;
    maxSizeByObject.set(key, Math.max(maxSizeByObject.get(key) ?? 0, row.size));
    if (row.fileType.startsWith('image/')) counts.images += 1;
    else if (row.fileType.startsWith('video/')) counts.videos += 1;
    else counts.other += 1;
  }

  return {
    bytes: [...maxSizeByObject.values()].reduce((sum, size) => sum + size, 0),
    fileCount: rows.length,
    files: counts,
    rounds: runIds.length,
  };
};

export const purgeAcceptance = async (
  db: LobeChatDatabase,
  fileService: FileService,
  userId: string,
  workspaceId: string | undefined,
  acceptanceId: string,
): Promise<{ deletedFiles: number; deletedRuns: number }> => {
  const runIds = await listRunIds(db, userId, workspaceId, acceptanceId);
  const fileIds = await listEvidenceFileIds(db, runIds);
  const deletedFiles = await purgeFiles(db, fileService, userId, workspaceId, fileIds);

  await db.transaction(async (tx) => {
    if (runIds.length > 0) {
      await tx
        .delete(verifyRuns)
        .where(
          and(
            inArray(verifyRuns.id, runIds),
            buildWorkspaceWhere({ userId, workspaceId }, verifyRuns),
          ),
        );
    }
    await new AcceptanceModel(tx, userId, workspaceId).delete(acceptanceId);
  });

  return { deletedFiles, deletedRuns: runIds.length };
};

export const purgeVerifyRun = async (
  db: LobeChatDatabase,
  fileService: FileService,
  userId: string,
  workspaceId: string | undefined,
  verifyRunId: string,
): Promise<{ deletedFiles: number }> => {
  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const run = await runModel.findById(verifyRunId);
  if (!run) return { deletedFiles: 0 };

  const fileIds = await listEvidenceFileIds(db, [run.id]);
  const deletedFiles = await purgeFiles(db, fileService, userId, workspaceId, fileIds);
  await runModel.delete(run.id);

  return { deletedFiles };
};
