import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  SHARE_UPLOAD_STORAGE_BLOCK_PREFIX,
  SHARE_VISITOR_MAX_FILE_SIZE,
  SHARE_VISITOR_MAX_FILES_PER_TURN,
} from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { ChatErrorType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import pMap from 'p-map';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { AgentShareModel } from '@/database/models/agentShare';
import { FileModel } from '@/database/models/file';
import { FileUploadModel } from '@/database/models/fileUpload';
import { files } from '@/database/schemas';
import { FileS3 } from '@/server/modules/S3';
import {
  sanitizeShareUploadName,
  shareUploadPrefix,
} from '@/server/services/agentShare/uploadPath';

/** The share a visitor's Channel attachments are copied into, and what bounds them. */
export interface ShareAttachmentTarget {
  agentId: string;
  /** `shareConfig.maxFileStorage`; `0` turns visitor attachments off. */
  maxFileStorage?: number;
  ownerId: string;
  shareId: string;
  visitorUserId: string;
  workspaceId: string | null;
}

interface SourceFile {
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

/** A refusal of the visitor's attachments, named by the share-limit type its reply fails with. */
export class ShareAttachmentRefusal extends Error {
  constructor(readonly type: string) {
    super(type);
  }
}

/**
 * The creator's account-level storage block (`storage_block:*` from the deployment's upload
 * check) reads as the share's storage being full: the creator's billing state is not the
 * visitor's to learn, and the remedy is the same. Any other failure keeps its own cause.
 */
const toShareStorageRefusal = (error: unknown) =>
  error instanceof TRPCError &&
  error.code === 'FORBIDDEN' &&
  error.message.startsWith(SHARE_UPLOAD_STORAGE_BLOCK_PREFIX)
    ? new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded)
    : error;

/** The visitor's own files among `fileIds`, in their order. Anything else is not theirs to attach. */
export const readVisitorFiles = async (
  db: LobeChatDatabase,
  visitorUserId: string,
  fileIds: string[],
): Promise<SourceFile[]> => {
  const ids = [...new Set(fileIds)];
  if (!ids.length) return [];
  const rows = await db
    .select({
      fileType: files.fileType,
      id: files.id,
      name: files.name,
      size: files.size,
      url: files.url,
    })
    .from(files)
    .where(and(inArray(files.id, ids), eq(files.userId, visitorUserId)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
};

/**
 * The bounds the share page applies to a visitor's upload, given each of the visitor's messages'
 * files: the file count per message, and each file's size. Checked before the reply opens, so an
 * oversized turn is refused before anything is copied or acknowledged.
 */
export const shareAttachmentLimitType = (
  messages: Pick<SourceFile, 'size'>[][],
  maxFileStorage = AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
) => {
  const sources = messages.flat();
  if (!sources.length) return;
  if (
    messages.some((files) => files.length > SHARE_VISITOR_MAX_FILES_PER_TURN) ||
    sources.some((file) => file.size > SHARE_VISITOR_MAX_FILE_SIZE)
  )
    return ChatErrorType.ShareAttachmentTooLarge;
  if (maxFileStorage <= 0) return ChatErrorType.ShareFileStorageExceeded;
};

/**
 * Copy a visitor's attachments into the share for the owner's run, which cannot read the
 * visitor's own files. Each copy is a share upload like the share page writes: under the share's
 * storage prefix, outside `global_files`, with the `agentShare` provenance the run's file scope
 * reads, so it never lands in the owner's library and counts toward the share's
 * `maxFileStorage`. A redispatch of the same reply reuses the copy it already made.
 */
export const importShareAttachments = async (
  db: LobeChatDatabase,
  target: ShareAttachmentTarget,
  sources: SourceFile[],
): Promise<string[]> => {
  if (!sources.length) return [];
  const prefix = shareUploadPrefix(target);
  const workspaceId = target.workspaceId ?? undefined;
  const maxFileStorage = target.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE;
  const s3 = new FileS3();
  const fileModel = new FileModel(db, target.ownerId, workspaceId);
  const uploadModel = new FileUploadModel(db, target.ownerId, workspaceId);
  /** Best-effort cleanup of objects no row references; a few deletes at a time. */
  const deleteObjects = async (pathnames: string[]) => {
    let failed = 0;
    await pMap(
      pathnames,
      (pathname) =>
        s3.deleteFile(pathname).catch(() => {
          failed += 1;
        }),
      { concurrency: 5 },
    );
    // Such an object holds bucket storage no row or upload sweep accounts for.
    if (failed)
      console.error('[channel:share-attachments] cleanup left unreferenced objects', {
        failed,
        shareId: target.shareId,
      });
  };
  const provenance = { shareId: target.shareId, visitorUserId: target.visitorUserId };

  /** Each source's copies live under their own folder, so a redispatch finds the one it made. */
  const copyOf = async (tx: LobeChatDatabase, source: SourceFile) => {
    const [copy] = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.userId, target.ownerId),
          sql`starts_with(${files.url}, ${`${prefix}channel/${source.id}/`})`,
          sql`${files.metadata} -> 'agentShare' ->> 'shareId' = ${target.shareId}`,
        ),
      )
      .limit(1);
    return copy?.id;
  };

  // A redispatch of the same reply copies only what it has not copied yet.
  const reused = new Map<string, string>();
  for (const source of sources) {
    const existing = await copyOf(db, source);
    if (existing) reused.set(source.id, existing);
  }

  // Refuse a turn that cannot fit before transferring anything. Advisory: concurrent uploads may
  // still fill the share meanwhile, so the transaction below counts again before settling.
  const pending = sources.filter((source) => !reused.has(source.id));
  if (pending.length) {
    const used =
      (await fileModel.countAgentShareUsage(target.shareId)) +
      (await uploadModel.countLiveUsageUnderPrefix(prefix));
    if (used + pending.reduce((total, source) => total + source.size, 0) > maxFileStorage)
      throw new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded);
  }

  // A key of its own per attempt, so a refused or concurrent attempt deletes only its own objects.
  // Only each copy's size is kept: a turn's bytes are never held in memory together.
  const uploaded: Array<{ pathname: string; size: number; source: SourceFile }> = [];
  /** Every key this attempt tried to write: a rejected upload may still have stored its object. */
  const attempted: string[] = [];
  let created: Map<string, string>;
  const orphaned: string[] = [];
  try {
    for (const source of sources) {
      if (reused.has(source.id)) continue;
      const pathname = `${prefix}channel/${source.id}/${nanoid()}/${sanitizeShareUploadName(source.name)}`;
      const bytes = Buffer.from(await s3.getFileByteArray(source.url));
      attempted.push(pathname);
      await s3.uploadBuffer(pathname, bytes, source.fileType);
      uploaded.push({ pathname, size: bytes.length, source });
    }

    // One transaction for the whole turn: a file beyond the share's storage leaves none of the
    // turn's copies behind to hold storage that no message references.
    created = await db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      // The order `shareChat.createFile` takes: the Agent row a transfer's revocation locks,
      // then the share's upload admission, so its cap counts never interleave.
      const locked = await AgentShareModel.lockScopedAgentRow(tx, target.agentId, {
        userId: target.ownerId,
        workspaceId,
      });
      if (
        !locked ||
        !(await AgentShareModel.isRunStillAuthorized(tx, {
          agentId: target.agentId,
          shareId: target.shareId,
          visitorUserId: target.visitorUserId,
        }))
      )
        throw new Error('This Agent is no longer shared');
      await AgentShareModel.lockUploadAdmission(tx, target.shareId);

      const ids = new Map<string, string>();
      for (const { pathname, size, source } of uploaded) {
        const concurrent = await copyOf(tx, source);
        if (concurrent) {
          ids.set(source.id, concurrent);
          orphaned.push(pathname);
          continue;
        }

        // Counted per file inside the transaction, so each sees the copies written before it.
        const settled = await fileModel.countAgentShareUsage(target.shareId, trx);
        const reserved = await uploadModel.countLiveUsageUnderPrefix(prefix, trx);
        if (settled + reserved + size > maxFileStorage)
          throw new ShareAttachmentRefusal(ChatErrorType.ShareFileStorageExceeded);
        try {
          await businessFileUploadCheck({
            actualSize: size,
            inputSize: source.size,
            transaction: trx,
            url: pathname,
            userId: target.ownerId,
            workspaceId: target.workspaceId,
          });
        } catch (error) {
          throw toShareStorageRefusal(error);
        }

        const parts = pathname.split('/');
        const filename = parts.pop()!;
        const file = await fileModel.create(
          {
            fileType: source.fileType,
            metadata: {
              agentShare: provenance,
              date: new Date().toISOString().slice(0, 10),
              dirname: parts.join('/'),
              filename,
              path: pathname,
            },
            name: sanitizeShareUploadName(source.name),
            size,
            url: pathname,
          },
          false,
          trx,
        );
        ids.set(source.id, file.id);
      }
      return ids;
    });
  } catch (error) {
    await deleteObjects(attempted);
    throw error;
  }

  // A source a concurrent dispatch settled first leaves this attempt's object unreferenced.
  await deleteObjects(orphaned);
  return sources.map((source) => reused.get(source.id) ?? created.get(source.id)!);
};
