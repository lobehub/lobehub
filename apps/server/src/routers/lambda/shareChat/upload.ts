import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  SHARE_UPLOAD_STORAGE_BLOCK_PREFIX,
  SHARE_VISITOR_MAX_FILE_SIZE,
} from '@lobechat/const';
import { agentShareFileAccessScope } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { serverDBEnv } from '@/config/db';
import { AgentShareModel } from '@/database/models/agentShare';
import { FileModel } from '@/database/models/file';
import { FileUploadModel } from '@/database/models/fileUpload';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { FileUploadService } from '@/server/services/fileUpload';
import { reserveUpload } from '@/server/services/fileUploadReservation';

import { resolveLinkShareOrThrow } from './guards';
import { shareChatProcedure } from './procedures';

const log = debug('lobe-server:router:shareChat');

/**
 * Storage key prefix for a share's visitor uploads, under the CREATOR's file
 * namespace. The prefix is what ties an upload session / file row back to a
 * specific share on the settle and abort paths: a visitor can only complete or
 * release reservations that live under their share's prefix, never one of the
 * creator's own uploads.
 */
const shareUploadPrefix = (share: {
  ownerId: string;
  shareId: string;
  workspaceId: string | null;
}) =>
  share.workspaceId
    ? `files/workspaces/${share.workspaceId}/agent-share/${share.shareId}/`
    : `files/${share.ownerId}/agent-share/${share.shareId}/`;

/**
 * Visitor-facing storage refusal, one shape for two causes: the share's own
 * `maxFileStorage` cap (`share_limit`), or the creator's account-level block
 * from the deployment's upload check (`creator_quota`). The latter's original
 * reason describes the creator's billing state; it is collapsed here because
 * a stranger with the link must not learn it, and the visitor's remedy is the
 * same either way. The client matches only the prefix.
 */
const shareStorageBlocked = (cause: 'creator_quota' | 'share_limit') =>
  new TRPCError({ code: 'FORBIDDEN', message: `${SHARE_UPLOAD_STORAGE_BLOCK_PREFIX}${cause}` });

const toVisitorStorageBlock = (error: unknown) => {
  if (
    error instanceof TRPCError &&
    error.code === 'FORBIDDEN' &&
    error.message.startsWith(SHARE_UPLOAD_STORAGE_BLOCK_PREFIX) &&
    error.message !== `${SHARE_UPLOAD_STORAGE_BLOCK_PREFIX}share_limit`
  ) {
    log('creator storage block collapsed for visitor: %s', error.message);
    return shareStorageBlocked('creator_quota');
  }
  return error;
};

/** Basename only — a visitor-supplied name must not steer the storage key. */
const sanitizeUploadName = (name: string) =>
  name
    .replaceAll(/[/\\]/g, '_')
    .replaceAll(/\p{Cc}/gu, '')
    .trim() || 'file';

/**
 * Metadata a visitor may attach to their upload — the same intrinsic
 * image/audio facts the owner upload path records client-side, so share
 * attachments render (dimensions, duration) exactly like owner ones. Anything
 * else (notably `agentShare`) is server-written.
 */
const ShareUploadMetadataSchema = z
  .object({
    codec: z.string().max(64),
    durationMs: z.number().nonnegative(),
    height: z.number().positive(),
    mimeType: z.string().max(255),
    ratio: z.number().positive(),
    width: z.number().positive(),
  })
  .partial();

export const uploadRouter = router({
  /**
   * Release a share upload reservation the visitor abandoned (PUT failed or
   * was cancelled). Scoped to the share's own key prefix so a visitor cannot
   * release one of the creator's in-flight uploads.
   */
  abortUpload: shareChatProcedure
    .input(z.object({ pathname: z.string().min(1), shareId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);
      if (!input.pathname.startsWith(shareUploadPrefix(share))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found' });
      }

      const fileUploadService = new FileUploadService(
        ctx.serverDB,
        share.ownerId,
        share.workspaceId ?? undefined,
      );
      const upload = await fileUploadService.findLatest(input.pathname);
      if (upload?.status === 'active') await fileUploadService.release(input.pathname);

      return { success: true };
    }),
  /**
   * Settle a share upload into a file row — the visitor counterpart of
   * `file.createFile`.
   *
   * The row is written under the CREATOR: share conversations are creator-owned
   * data (topics/messages already are), and the creator's storage quota is what
   * paid for the reservation in `createUploadUrl`. What makes it the visitor's
   * attachment rather than a creator resource is the server-written
   * `metadata.agentShare` provenance every share read/write path checks.
   *
   * Deliberately simpler than the owner path: no knowledge base / parent
   * folder / visibility, and no content hash at all. Every share upload is its
   * own object under its own reserved key, so the row must stay OUT of the
   * hash-keyed `global_files` dedup graph: a row registered there with a hash
   * some other file already holds would have its object skipped by the
   * refcount in `FileModel.delete` and orphaned in storage on `removeFile`
   * (with the visitor never able to see or free it), while its share-cap bytes
   * were released. A visitor attachment is only ever reached through the
   * message it was sent with, so nothing needs the hash.
   */
  createFile: shareChatProcedure
    .input(
      z.object({
        fileType: z.string().min(1).max(255),
        metadata: ShareUploadMetadataSchema.optional(),
        name: z.string().min(1).max(255),
        pathname: z.string().min(1),
        shareId: z.string(),
        size: z.number().int().min(0).max(SHARE_VISITOR_MAX_FILE_SIZE),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);
      if (!input.pathname.startsWith(shareUploadPrefix(share))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found' });
      }

      const fileUploadService = new FileUploadService(
        ctx.serverDB,
        share.ownerId,
        share.workspaceId ?? undefined,
      );
      const fileService = new FileService(
        ctx.serverDB,
        share.ownerId,
        share.workspaceId ?? undefined,
      );

      // No legacy (reservation-less) path here: the share upload flow was born
      // with reservations, so a pathname without an active session is either
      // expired, already settled, or never ours.
      const activeUpload = await fileUploadService.touchActive(input.pathname);
      if (!activeUpload) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
      }

      let actualSize: number;
      try {
        actualSize = (await fileService.getFileMetadata(input.pathname)).contentLength;
      } catch {
        await fileUploadService.releaseBestEffort(input.pathname);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uploaded file is unavailable' });
      }
      if (input.size !== activeUpload.size || actualSize !== activeUpload.size) {
        await fileUploadService.releaseBestEffort(input.pathname);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uploaded file size mismatch' });
      }

      const parts = input.pathname.split('/');
      const filename = parts.pop()!;
      const dirname = parts.join('/');

      const { id } = await ctx.serverDB.transaction(async (trx) => {
        // Transfer hard revocation locks this same Agent row before it snapshots
        // and deletes share files. Taking the lock first gives the two paths a
        // single order: if settlement wins, transfer sees and removes this
        // file; if transfer wins, the locked recheck below rejects the stale
        // share before a new file row can escape the cleanup snapshot.
        const tx = trx as LobeChatDatabase;
        const lockedAgent = await AgentShareModel.lockScopedAgentRow(tx, share.agentId, {
          userId: share.ownerId,
          workspaceId: share.workspaceId ?? undefined,
        });
        if (
          !lockedAgent ||
          !(await AgentShareModel.isRunStillAuthorized(tx, {
            agentId: share.agentId,
            shareId: share.shareId,
          }))
        ) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
        }

        const lockedUpload = await fileUploadService.model.findLatestByPathnameForUpdate(
          input.pathname,
          trx,
        );
        if (lockedUpload?.id !== activeUpload.id || lockedUpload.status !== 'active') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
        }

        const file = await new FileModel(
          ctx.serverDB,
          share.ownerId,
          share.workspaceId ?? undefined,
        ).create(
          {
            fileType: input.fileType,
            metadata: {
              ...input.metadata,
              agentShare: { shareId: share.shareId, visitorUserId: ctx.userId },
              date: new Date().toISOString().slice(0, 10),
              dirname,
              filename,
              path: input.pathname,
            },
            name: sanitizeUploadName(input.name),
            size: actualSize,
            url: input.pathname,
          },
          false,
          trx,
        );

        const settled = await fileUploadService.model.settle(lockedUpload.id, file.id, trx);
        if (!settled) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Upload could not be settled' });
        }
        return file;
      });

      log('createFile: share=%s visitor=%s file=%s', input.shareId, ctx.userId, id);

      return { id, url: await fileService.getFileAccessUrl({ id, url: input.pathname }) };
    }),
  /**
   * Reserve storage and mint a pre-signed PUT for a visitor attachment — the
   * visitor counterpart of `upload.createS3PreSignedUrl`.
   *
   * The reservation is taken under the CREATOR: the bytes count against the
   * creator's storage quota, so it is the creator's `storage_block:*` reason
   * (not the visitor's plan) that decides whether the upload is admitted. The
   * key lives under the share's own prefix so `createFile` / `abortUpload` can
   * prove the session belongs to this share.
   */
  createUploadUrl: shareChatProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        shareId: z.string(),
        // `min(1)` is load-bearing beyond validation: the reservation runs the
        // size through the deployment's upload check AS THE CREATOR, so a
        // visitor-supplied negative size must never reach it — and a zero-byte
        // reservation adds nothing to the cap sum, so it would let unbounded
        // rows (and objects) pile up under the creator's prefix.
        size: z.number().int().min(1).max(SHARE_VISITOR_MAX_FILE_SIZE),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const maxFileStorage =
        share.shareConfig.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE;
      // Cheap pre-check before any storage round-trip; the real, race-free
      // check is `admit` below. `<= 0` is the creator turning attachments off
      // and refuses regardless of size.
      if (maxFileStorage <= 0 || input.size > maxFileStorage) {
        throw shareStorageBlocked('share_limit');
      }

      const prefix = shareUploadPrefix(share);
      const pathname = `${prefix}${nanoid()}/${sanitizeUploadName(input.name)}`;
      const s3 = new FileS3();
      const uploadModel = new FileUploadModel(
        ctx.serverDB,
        share.ownerId,
        share.workspaceId ?? undefined,
      );
      const fileModel = new FileModel(ctx.serverDB, share.ownerId, share.workspaceId ?? undefined);

      try {
        await reserveUpload({
          // The share's own cap: settled visitor files plus every live
          // reservation under the share prefix, counted inside the reservation
          // transaction. The counts alone are not race-free (the reservation's
          // own row lock comes after this hook), so the decision is serialized
          // per share first — see `AgentShareModel.lockUploadAdmission`.
          admit: async (transaction) => {
            await AgentShareModel.lockUploadAdmission(transaction, share.shareId);
            const settled = await fileModel.countAgentShareUsage(share.shareId, transaction);
            const reserved = await uploadModel.countLiveUsageUnderPrefix(prefix, transaction);
            if (settled + reserved + input.size > maxFileStorage) {
              throw shareStorageBlocked('share_limit');
            }
          },
          clientIp: ctx.clientIp ?? undefined,
          db: ctx.serverDB,
          model: uploadModel,
          pathname,
          size: input.size,
          storage: s3,
          userId: share.ownerId,
          workspaceId: share.workspaceId,
        });
      } catch (error) {
        throw toVisitorStorageBlock(error);
      }

      try {
        return { pathname, url: await s3.createPreSignedUrl(pathname, input.size) };
      } catch (error) {
        await new FileUploadService(
          ctx.serverDB,
          share.ownerId,
          share.workspaceId ?? undefined,
        ).releaseBestEffort(pathname);
        throw error;
      }
    }),
  /**
   * Drop a share upload the visitor removed from their draft before sending.
   * Only the uploading visitor's own share files qualify (provenance check),
   * and only while no message references the row — once sent, the attachment
   * is part of a creator-owned conversation and stays put.
   *
   * Share rows are created outside `global_files` (see `createFile`), so their
   * persisted provenance tells `FileModel` that the row owns its object.
   */
  removeFile: shareChatProcedure
    .input(z.object({ fileId: z.string().min(1).max(64), shareId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const fileModel = new FileModel(ctx.serverDB, share.ownerId, share.workspaceId ?? undefined);
      const accessScope = agentShareFileAccessScope({
        shareId: share.shareId,
        visitorUserId: ctx.userId,
      });
      const existing = await fileModel.findById(input.fileId, { accessScope });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      const file = await fileModel.deleteUnreferenced(input.fileId, {
        accessScope,
        removeGlobalFile: serverDBEnv.REMOVE_GLOBAL_FILE,
      });
      if (!file) return;

      await new FileService(ctx.serverDB, share.ownerId, share.workspaceId ?? undefined).deleteFile(
        file.url!,
      );
    }),
});
