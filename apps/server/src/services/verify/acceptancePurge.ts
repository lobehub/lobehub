import { FileSource } from '@lobechat/types';
import { and, eq, inArray, isNotNull, notExists, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { serverDBEnv } from '@/config/db';
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
  acceptanceIds: string[],
) => {
  if (acceptanceIds.length === 0) return [];
  const rows = await db
    .select({ id: verifyRuns.id })
    .from(verifyRuns)
    .where(
      and(
        inArray(verifyRuns.acceptanceId, acceptanceIds),
        buildWorkspaceWhere({ userId, workspaceId }, verifyRuns),
      ),
    );
  return rows.map((row) => row.id);
};

const listExclusiveEvidenceFileIds = async (db: LobeChatDatabase, runIds: string[]) => {
  if (runIds.length === 0) return [];
  const otherEvidence = alias(verifyEvidence, 'other_evidence');
  const otherResults = alias(verifyCheckResults, 'other_results');
  const rows = await db
    .selectDistinct({ fileId: verifyEvidence.fileId })
    .from(verifyEvidence)
    .innerJoin(verifyCheckResults, eq(verifyCheckResults.id, verifyEvidence.checkResultId))
    .innerJoin(files, eq(files.id, verifyEvidence.fileId))
    .where(
      and(
        inArray(verifyCheckResults.verifyRunId, runIds),
        isNotNull(verifyEvidence.fileId),
        eq(files.source, FileSource.Acceptance),
        notExists(
          db
            .select({ id: otherEvidence.id })
            .from(otherEvidence)
            .innerJoin(otherResults, eq(otherResults.id, otherEvidence.checkResultId))
            .where(
              and(
                eq(otherEvidence.fileId, verifyEvidence.fileId),
                notInArray(otherResults.verifyRunId, runIds),
              ),
            ),
        ),
      ),
    );
  return rows.map((row) => row.fileId!);
};

const listRetainedHashes = async (
  db: LobeChatDatabase,
  rows: { fileHash: string | null; id: string }[],
) => {
  const hashes = rows.map((row) => row.fileHash).filter((hash): hash is string => Boolean(hash));
  if (hashes.length === 0) return new Set<string | null>();
  const outside = await db
    .select({ fileHash: files.fileHash })
    .from(files)
    .where(
      and(
        inArray(files.fileHash, hashes),
        notInArray(
          files.id,
          rows.map((row) => row.id),
        ),
      ),
    );
  return new Set(outside.map((row) => row.fileHash));
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
    .select({ fileHash: files.fileHash, id: files.id, url: files.url })
    .from(files)
    .where(and(inArray(files.id, fileIds), buildWorkspaceWhere({ userId, workspaceId }, files)));
  if (owned.length === 0) return 0;

  const removeGlobalFile = serverDBEnv.REMOVE_GLOBAL_FILE;
  const unreferenced = await new FileModel(db, userId, workspaceId).deleteMany(
    owned.map((file) => file.id),
    removeGlobalFile,
  );
  if (!removeGlobalFile) return owned.length;

  const urls = new Set([
    ...unreferenced.map((file) => file.url),
    ...owned.filter((file) => !file.fileHash).map((file) => file.url),
  ]);
  if (urls.size > 0) {
    try {
      await fileService.deleteFiles([...urls]);
    } catch (error) {
      console.error('[acceptance:purge] storage delete failed', error);
    }
  }
  return owned.length;
};

export const previewAcceptancePurge = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  acceptanceIds: string[],
): Promise<PurgePreview> => {
  const runIds = await listRunIds(db, userId, workspaceId, acceptanceIds);
  const fileIds = await listExclusiveEvidenceFileIds(db, runIds);
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

  const retained = await listRetainedHashes(db, rows);
  const maxSizeByObject = new Map<string, number>();
  const counts = { ...empty.files };
  for (const row of rows) {
    if (row.fileType.startsWith('image/')) counts.images += 1;
    else if (row.fileType.startsWith('video/')) counts.videos += 1;
    else counts.other += 1;
    if (row.fileHash && retained.has(row.fileHash)) continue;
    const key = row.fileHash ?? row.id;
    maxSizeByObject.set(key, Math.max(maxSizeByObject.get(key) ?? 0, row.size));
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
  const runIds = await listRunIds(db, userId, workspaceId, [acceptanceId]);
  const fileIds = await listExclusiveEvidenceFileIds(db, runIds);
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

  const fileIds = await listExclusiveEvidenceFileIds(db, [run.id]);
  const deletedFiles = await purgeFiles(db, fileService, userId, workspaceId, fileIds);
  await runModel.delete(run.id);

  return { deletedFiles };
};
