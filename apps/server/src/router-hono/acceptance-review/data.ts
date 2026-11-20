import { randomUUID } from 'node:crypto';

import { FileSource } from '@lobechat/types';
import { desc, eq } from 'drizzle-orm';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';
import { users, verifyRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

export const latestRound = async (db: LobeChatDatabase, acceptanceId: string) => {
  const [run] = await db
    .select({ id: verifyRuns.id, metadata: verifyRuns.metadata, roundIndex: verifyRuns.roundIndex })
    .from(verifyRuns)
    .where(eq(verifyRuns.acceptanceId, acceptanceId))
    .orderBy(desc(verifyRuns.roundIndex))
    .limit(1);
  if (!run) return { previewUrl: undefined, round: 0, runId: undefined };
  const previewUrl = run.metadata?.previewUrl;
  return {
    previewUrl: typeof previewUrl === 'string' ? previewUrl : undefined,
    round: run.roundIndex ?? 0,
    runId: run.id,
  };
};

export const findProfile = async (db: LobeChatDatabase, userId: string) => {
  const [profile] = await db
    .select({ avatar: users.avatar, fullName: users.fullName, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return profile;
};

export const commentBelongsTo = async (
  db: LobeChatDatabase,
  commentId: string,
  acceptanceId: string,
) => {
  const comment = await new AcceptanceCommentModel(db).findById(commentId);
  return comment?.acceptanceId === acceptanceId;
};

const SCREENSHOT = /^data:image\/(jpeg|webp);base64,(.+)$/;

export const uploadScreenshot = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
  dataUrl: string,
) => {
  const [, format, base64] = dataUrl.match(SCREENSHOT) ?? [];
  const buffer = Buffer.from(base64 ?? '', 'base64');
  const pathname = `acceptance-review/${userId}/${randomUUID()}.${format === 'webp' ? 'webp' : 'jpg'}`;
  const { fileId } = await new FileService(db, userId, workspaceId ?? undefined).uploadFromBuffer(
    buffer,
    `image/${format}`,
    pathname,
    (transaction) =>
      businessFileUploadCheck({
        actualSize: buffer.length,
        inputSize: buffer.length,
        transaction,
        url: pathname,
        userId,
        workspaceId: workspaceId ?? undefined,
      }),
    { source: FileSource.Acceptance, visibility: 'private' },
  );
  return fileId;
};
