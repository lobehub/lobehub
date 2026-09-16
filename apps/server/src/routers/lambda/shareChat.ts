import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  SHARE_UPLOAD_STORAGE_BLOCK_PREFIX,
  SHARE_VISITOR_MAX_FILE_SIZE,
  SHARE_VISITOR_MAX_FILES_PER_TURN,
  SHARE_VISITOR_PROMPT_MAX_LENGTH,
} from '@lobechat/const';
import type { ChatMessageError } from '@lobechat/types';
import { ChatErrorType, entityIdPattern, FileSource, RequestTrigger } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { checkAgentShareSpendAllowance } from '@/business/server/agent-share/spendGate';
import { serverDBEnv } from '@/config/db';
import { AgentShareModel } from '@/database/models/agentShare';
import { FileModel } from '@/database/models/file';
import { FileUploadModel } from '@/database/models/fileUpload';
import { MessageModel, sanitizeVisitorError } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { FileS3 } from '@/server/modules/S3';
import { AiAgentService } from '@/server/services/aiAgent';
import type { AgentShareGate } from '@/server/services/aiAgent/shareGate';
import { FileService } from '@/server/services/file';
import { FileUploadService } from '@/server/services/fileUpload';
import { reserveUpload } from '@/server/services/fileUploadReservation';

import { assertAgentShareVisitorEnabled } from './_helpers/agentShareFeatureGate';

const log = debug('lobe-server:router:shareChat');

/**
 * Visitor-facing execution chain for shared agents (Agent Share).
 *
 * All procedures authenticate the VISITOR (ctx.userId) but operate on
 * CREATOR-owned rows: topics/messages of a share conversation carry the
 * creator's userId (so runtime, billing, and tool paths behave exactly as a
 * creator-owned chat) plus `topics.senderId = visitor` for scoping. Every
 * read/write here is therefore manually authorized: resolve the share via
 * {@link resolveLinkShareOrThrow}, then require
 * `topic.senderId === visitor && topic.agentId === share.agentId`
 * ({@link findVisitorTopicOrThrow}).
 *
 * There is no share-instance column on `topics`: a visitor topic is tied to
 * its share purely through `(agentId, senderId)`, which is unambiguous because
 * `agent_shares` is 1:1 per agent. The known consequence is that a visitor's
 * own older topics resurface after an owner disables and re-enables the share
 * (a pause that keeps the same row, so nothing marks the topics as belonging
 * to an earlier run of it). That crosses no identity boundary — it is the same
 * visitor's own prior conversation with the same agent — but it does mean the
 * per-visitor topic cap counts them.
 *
 * Agent sharing is personal-only (workspace agents cannot be shared), so no
 * workspaceId is ever threaded into the creator-scoped models/services.
 */
const shareChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  // Visitor access depends on deployment support and share permissions,
  // not the publishing rollout flag.
  assertAgentShareVisitorEnabled();

  return opts.next();
});

const ShareTopicScopeSchema = z.object({
  shareId: z.string(),
  topicId: z.string(),
});

/**
 * Resolve a share for the VISITOR execution path.
 *
 * Stricter than the plain `findByShareIdWithAccessCheck` used by the read-only
 * share page: that helper deliberately lets the OWNER through on a `private`
 * share (so they can preview their own unpublished page), but the owner never
 * uses this visitor chain — they chat with their own agent through
 * `aiAgent.execAgent`. Requiring `link` here keeps this entry point in exact
 * agreement with the per-step revalidation
 * (`AgentShareModel.isRunStillAuthorized`, which also demands `link`), so a
 * run can never be authorized to start under a rule its own step loop would
 * immediately abort it for.
 */
const resolveLinkShareOrThrow = async (db: LobeChatDatabase, shareId: string, viewerId: string) => {
  const share = await AgentShareModel.findByShareIdWithAccessCheck(db, shareId, viewerId);

  if (share.visibility !== 'link') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
  }

  return share;
};

/**
 * Resolve a visitor-owned share topic or fail closed. The topic row belongs to
 * the creator (creator-scoped TopicModel), so the senderId + agentId match is
 * the ONLY thing standing between a visitor and the creator's other topics.
 */
const findVisitorTopicOrThrow = async (
  topicModel: TopicModel,
  params: { agentId: string; topicId: string; visitorUserId: string },
) => {
  const topic = await topicModel.findById(params.topicId);

  if (!topic || topic.senderId !== params.visitorUserId || topic.agentId !== params.agentId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  }

  return topic;
};

/**
 * Convert an internal startup failure into a visitor-safe `TRPCError` — reuses
 * `sanitizeVisitorError` (`packages/database/src/models/message.ts`) instead of
 * a third ad-hoc redaction. `execAgent`/`interruptTask` can throw BEFORE any
 * Gateway streaming starts (e.g. the queue or runtime backend returns a
 * diagnostic), a failure surface neither existing visitor projection covers —
 * `toVisitorMessage` only runs over persisted rows and the Gateway event
 * sanitizer only runs over live stream events — so without this, the raw
 * `error.message` (which can carry the creator's provider/infra diagnostic,
 * since the run executes under the CREATOR's identity) went straight to the
 * visitor. Logs the raw error server-side and returns only the classified
 * `{ type }` (or `{ message }` for the narrow allowlisted codes) that
 * `sanitizeVisitorError` already deems visitor-safe.
 *
 * `showErrorDetails` (the owner's opt-in on the share config) bypasses the
 * projection, exactly as it does for persisted rows and live stream events.
 *
 * Also the sink for a RESOLVED (not thrown) `{ success: false, error }` from
 * `AiAgentService.execAgent` — a `createOperation` startup failure resolves
 * rather than rejects there, so the visitor-facing `execAgent` handler below
 * re-throws that case through this same function instead of letting the raw
 * message escape via a normal `return`.
 */
const toVisitorSafeStartupError = (
  context: string,
  error: unknown,
  options: { showErrorDetails?: boolean } = {},
): TRPCError => {
  log('%s failed: %O', context, error);

  const raw = error as { message?: unknown; type?: unknown } | null | undefined;
  const safe = sanitizeVisitorError(
    raw && typeof raw === 'object'
      ? ({
          message: typeof raw.message === 'string' ? raw.message : undefined,
          type: raw.type,
        } as ChatMessageError)
      : undefined,
    options,
  );

  // `type` widens to `string | number` (the numeric HTTP-status error codes),
  // while `TRPCError.message` is `string | undefined` — stringify rather than
  // drop the numeric codes, which are exactly as visitor-safe as the rest.
  const publicMessage = safe?.message ?? safe?.type;

  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: publicMessage === undefined ? 'Internal error' : String(publicMessage),
  });
};

/**
 * Authorize a visitor to act on a share run. It is not enough that the topic
 * belongs to this visitor: `operationId` must also match the operation
 * CURRENTLY recorded as running on that topic. Without that check a visitor
 * could pass an arbitrary operationId (topics/operations are creator-owned
 * rows) and reach an unrelated run on the creator's account.
 *
 * Returns the creator-scoped service, same as `execAgent`: the run's operation
 * / thread rows were written under the creator's identity.
 */
const authorizeVisitorRunningOperation = async (
  db: LobeChatDatabase,
  visitorUserId: string,
  input: { operationId: string; shareId: string; topicId: string },
) => {
  const share = await resolveLinkShareOrThrow(db, input.shareId, visitorUserId);

  const topicModel = new TopicModel(db, share.ownerId, undefined, undefined, {
    includeShareVisitor: true,
  });
  const topic = await findVisitorTopicOrThrow(topicModel, {
    agentId: share.agentId,
    topicId: input.topicId,
    visitorUserId,
  });

  const runningOperationId = topic.metadata?.runningOperation?.operationId;
  if (!runningOperationId || runningOperationId !== input.operationId) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'No matching running operation found on this topic',
    });
  }

  const aiAgentService = new AiAgentService(db, share.ownerId, {
    includeShareVisitor: true,
  });

  return { aiAgentService, share };
};

/**
 * Storage key prefix for a share's visitor uploads, under the CREATOR's file
 * namespace. The prefix is what ties an upload session / file row back to a
 * specific share on the settle and abort paths: a visitor can only complete or
 * release reservations that live under their share's prefix, never one of the
 * creator's own uploads.
 */
const shareUploadPrefix = (ownerId: string, shareId: string) =>
  `files/${ownerId}/agent-share/${shareId}/`;

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

const shareFileProvenance = (
  file: { metadata?: unknown; source?: string | null } | undefined,
): { shareId: string; visitorUserId: string } | undefined => {
  if (!file || file.source !== FileSource.AgentShare) return undefined;
  const metadata = file.metadata as { agentShare?: unknown } | null | undefined;
  const provenance = metadata?.agentShare as
    { shareId?: unknown; visitorUserId?: unknown } | undefined;
  if (typeof provenance?.shareId !== 'string' || typeof provenance.visitorUserId !== 'string') {
    return undefined;
  }
  return { shareId: provenance.shareId, visitorUserId: provenance.visitorUserId };
};

/**
 * Every attachment id a visitor pins to a turn must be a file THIS visitor
 * uploaded through THIS share (`shareChat.createFile`). Visitor uploads live
 * under the creator's account, so a creator-scoped lookup would happily
 * resolve any of the creator's files — the `agentShare` provenance on the row
 * is the only thing that stops a visitor from naming an arbitrary id and
 * having the creator's own document injected into the run. `NOT_FOUND` on
 * purpose — same fail-closed shape as the topic guard, revealing nothing
 * about whether the id exists for someone else.
 */
const assertShareVisitorFiles = async (
  db: LobeChatDatabase,
  share: { ownerId: string; shareId: string },
  visitorUserId: string,
  fileIds: string[] | undefined,
) => {
  if (!fileIds?.length) return;

  const uniqueIds = Array.from(new Set(fileIds));
  const rows = await new FileModel(db, share.ownerId).findByIds(uniqueIds);
  const owned = rows.filter((file) => {
    const provenance = shareFileProvenance(file);
    return provenance?.shareId === share.shareId && provenance.visitorUserId === visitorUserId;
  });
  if (owned.length !== uniqueIds.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
  }
};

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

export const shareChatRouter = router({
  /**
   * Release a share upload reservation the visitor abandoned (PUT failed or
   * was cancelled). Scoped to the share's own key prefix so a visitor cannot
   * release one of the creator's in-flight uploads.
   */
  abortUpload: shareChatProcedure
    .input(z.object({ pathname: z.string().min(1), shareId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);
      if (!input.pathname.startsWith(shareUploadPrefix(share.ownerId, share.shareId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found' });
      }

      const fileUploadService = new FileUploadService(ctx.serverDB, share.ownerId);
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
   * attachment rather than a creator resource is `source: agent_share` (hidden
   * from the creator's library and knowledge listings) plus the
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
      if (!input.pathname.startsWith(shareUploadPrefix(share.ownerId, share.shareId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Upload not found' });
      }

      const fileUploadService = new FileUploadService(ctx.serverDB, share.ownerId);
      const fileService = new FileService(ctx.serverDB, share.ownerId);

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
        const lockedUpload = await fileUploadService.model.findLatestByPathnameForUpdate(
          input.pathname,
          trx,
        );
        if (lockedUpload?.id !== activeUpload.id || lockedUpload.status !== 'active') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Upload session is no longer active' });
        }

        const file = await new FileModel(ctx.serverDB, share.ownerId).create(
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
            source: FileSource.AgentShare,
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

      const prefix = shareUploadPrefix(share.ownerId, share.shareId);
      const pathname = `${prefix}${nanoid()}/${sanitizeUploadName(input.name)}`;
      const s3 = new FileS3();
      const uploadModel = new FileUploadModel(ctx.serverDB, share.ownerId);
      const fileModel = new FileModel(ctx.serverDB, share.ownerId);

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
        });
      } catch (error) {
        throw toVisitorStorageBlock(error);
      }

      try {
        return { pathname, url: await s3.createPreSignedUrl(pathname, input.size) };
      } catch (error) {
        await new FileUploadService(ctx.serverDB, share.ownerId).releaseBestEffort(pathname);
        throw error;
      }
    }),

  /**
   * Execute a shared agent as a visitor — the gateway-transport mirror of
   * `aiAgent.execAgent`, restricted to the share surface: fixed agent, no
   * device/local targets, share-config tool allowlist, per-visitor caps.
   */
  execAgent: shareChatProcedure
    .input(
      z.object({
        /** Client-minted row ids, honoured verbatim (see aiAgent.execAgent). */
        clientIds: z
          .object({
            assistantMessageId: z.string().regex(entityIdPattern('messages')).optional(),
            topicId: z.string().regex(entityIdPattern('topics')).optional(),
            userMessageId: z.string().regex(entityIdPattern('messages')).optional(),
          })
          .optional(),
        /**
         * Ids of files the VISITOR uploaded through `shareChat.createFile`.
         * Re-checked below against the file rows' share provenance — see
         * `assertShareVisitorFiles`.
         */
        fileIds: z
          .array(z.string().min(1).max(64))
          .max(SHARE_VISITOR_MAX_FILES_PER_TURN)
          .optional(),
        /** See `SHARE_VISITOR_PROMPT_MAX_LENGTH`'s JSDoc for the size-bound rationale. */
        prompt: z.string().max(SHARE_VISITOR_PROMPT_MAX_LENGTH),
        shareId: z.string(),
        /** Queued behind a running turn; see `aiAgent.execAgent`'s `steer`. */
        steer: z.boolean().optional(),
        /** Absent → the run creates a new visitor topic (counted against the topic cap). */
        topicId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      // Spend admission runs FIRST, before any row is created: a run rejected
      // by the runtime billing path instead fails mid-run, after the topic and
      // placeholder messages have persisted, leaving junk topics with a "..."
      // assistant row. No-op in deployments that do not meter share spend.
      const spendGate = await checkAgentShareSpendAllowance({
        agentId: share.agentId,
        monthlySpendLimit: share.shareConfig.monthlySpendLimit,
        ownerUserId: share.ownerId,
        shareId: share.shareId,
        visitorUserId: ctx.userId,
      });
      if (!spendGate.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: ChatErrorType.ShareSpendLimitExceeded,
        });
      }

      // Verify every attachment is this visitor's own share upload before it
      // is handed to a run that executes (and reads files) as the creator.
      // Also ahead of any row creation, like the spend gate — a foreign id
      // must not leave a topic behind.
      await assertShareVisitorFiles(ctx.serverDB, share, ctx.userId, input.fileIds);

      // Runtime-normalized (findByShareIdWithAccessCheck fills defaults), but
      // the config TYPE keeps every field optional — re-apply the same default
      // constants rather than asserting non-null.
      const maxTopicsPerVisitor =
        share.shareConfig.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR;
      const maxTurnsPerTopic =
        share.shareConfig.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC;
      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const messageModel = new MessageModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });

      // Fast, UX-only pre-check for both caps: reject an obviously-over-cap
      // request BEFORE paying for agent-config/tool resolution, instead of only
      // at dispatch. This is NOT the enforcement: it is a plain unlocked count,
      // so a burst of concurrent requests can all read the same pre-insert
      // count and all pass. The atomic, authoritative gate is
      // `reserveShareVisitorTopicOrThrow` / `reserveShareVisitorTurnOrThrow`
      // (`apps/server/src/services/aiAgent/shareVisitorAbuseGuards.ts`), which
      // locks and re-checks the same counters immediately around the real
      // topic/message INSERT inside `AiAgentService.execAgent`.
      if (input.topicId) {
        await findVisitorTopicOrThrow(topicModel, {
          agentId: share.agentId,
          topicId: input.topicId,
          visitorUserId: ctx.userId,
        });

        const turnCount = await messageModel.countByTopic({
          role: 'user',
          topicId: input.topicId,
        });
        if (turnCount >= maxTurnsPerTopic) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: ChatErrorType.ShareTurnLimitExceeded,
          });
        }
      } else {
        const topicCount = await topicModel.countBySender({
          agentId: share.agentId,
          senderId: ctx.userId,
        });
        if (topicCount >= maxTopicsPerVisitor) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: ChatErrorType.ShareTopicLimitExceeded,
          });
        }
      }

      // Creator-scoped service: the run executes under the creator's identity
      // (their agent config, connectors, billing context). The shareGate strips
      // everything the share config doesn't grant.
      const shareGate: AgentShareGate = {
        agentId: share.agentId,
        shareConfig: share.shareConfig,
        // See `AgentShareGate.shareId`'s JSDoc — the share instance this run is
        // authorized against, and the token every later revalidation compares.
        shareId: share.shareId,
        visitorUserId: ctx.userId,
      };

      // Creator's Market access token, mirroring aiAgentProcedure — the
      // server-side tool runtime authenticates against the Market API with it.
      let marketAccessToken: string | undefined;
      try {
        const userModel = new UserModel(ctx.serverDB, share.ownerId);
        const settings = await userModel.getUserSettings();
        marketAccessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService falls back to trustedClientToken
      }

      const aiAgentService = new AiAgentService(ctx.serverDB, share.ownerId, {
        // Share visitor turns persist under the creator's `userId` — the
        // service's internal `messageModel`/`topicModel`/runtime must be
        // constructed with the visitor scope so reads/writes on
        // `topics.senderId <> NULL` rows aren't filtered out.
        includeShareVisitor: true,
        marketAccessToken,
      });

      log('execAgent: share=%s visitor=%s topic=%s', input.shareId, ctx.userId, input.topicId);

      try {
        const result = await aiAgentService.execAgent({
          agentId: share.agentId,
          appContext: { topicId: input.topicId },
          clientIds: input.clientIds,
          clientIp: ctx.clientIp ?? undefined,
          // Share uploads are creator-owned rows (see `createFile` below), so
          // the creator-scoped runtime resolves them like any owner attachment.
          fileIds: input.fileIds,
          // `interactiveStart: true` (the `aiAgent.execAgent` owner path's
          // default) makes `TopicModel.tryReserveTaskCallback` skip its
          // `runningOperation` liveness check entirely — a policy that is safe
          // there ONLY because the owner's OWN client serializes sends.
          //
          // An untrusted visitor has no such client-side gate: firing two
          // concurrent `execAgent` mutations for the SAME topic would let both
          // pass the reservation (each only contends on the short-lived
          // `taskCallbackReservation`, released right after the first operation
          // is CREATED, long before it finishes streaming), so both would
          // create creator-credentialed operations. The second operation's
          // `runningOperation` marker write then overwrites the first's,
          // leaving the first unreachable by `shareChat.interruptTask` (which
          // matches on the topic's current marker) — an orphaned run that keeps
          // using tools and the creator's budget until it finishes on its own.
          //
          // Leaving this `false` routes visitor sends through the SAME
          // liveness-checked reservation every non-interactive start uses: a
          // second concurrent send for a topic with a live operation is
          // rejected instead of silently displacing the first.
          interactiveStart: false,
          prompt: input.prompt,
          shareGate,
          steer: input.steer,
          // Not `RequestTrigger.Chat`: a share run is billed to the CREATOR,
          // so its spend rows must be separable from the creator's own chat
          // spend (they land on the same account). The trigger rides
          // `state.origin.trigger` all the way into the spend-log metadata.
          trigger: RequestTrigger.AgentShare,
          userAgent: ctx.userAgent ?? undefined,
        });

        // `AiAgentService.execAgent` RESOLVES (does not throw) when
        // `createOperation` itself fails to start (e.g. the queue/runtime
        // backend is unavailable). That `error` is the same raw
        // `error.message` the thrown path guards against, so it must go through
        // the exact same projection instead of reaching the visitor verbatim.
        //
        // Reject rather than sanitize-and-return: the Gateway client never
        // checks `result.success` — it unconditionally treats the resolved
        // value as a live operation and connects with its
        // `operationId`/`token`. A sanitized `success: false` object would
        // still be consumed as if the run started, opening a WebSocket for an
        // operation that never began.
        if (!result.success) {
          throw toVisitorSafeStartupError(
            'execAgent',
            { message: result.error },
            { showErrorDetails: share.shareConfig.showErrorDetails },
          );
        }

        return result;
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('execAgent', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),

  /** Messages of one visitor-owned share topic. */
  getMessages: shareChatProcedure.input(ShareTopicScopeSchema).query(async ({ input, ctx }) => {
    const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

    const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
      includeShareVisitor: true,
    });
    await findVisitorTopicOrThrow(topicModel, {
      agentId: share.agentId,
      topicId: input.topicId,
      visitorUserId: ctx.userId,
    });

    const messageModel = new MessageModel(ctx.serverDB, share.ownerId, undefined, undefined, {
      includeShareVisitor: true,
    });
    const fileService = new FileService(ctx.serverDB, share.ownerId);

    // queryForVisitor strips the creator's `sender` identity, and — unless the
    // share opts in via `showModelInfo` / `showErrorDetails` — the spend/model
    // snapshot and raw error payload too. Share messages persist under the
    // CREATOR's account (see the module doc above), so the raw `query()` result
    // would otherwise leak the creator's account identity to the visitor.
    return messageModel.queryForVisitor(
      // skipWorks: Work summaries join live task/version state of the CREATOR's
      // account — never serve them to a visitor surface.
      { skipWorks: true, topicId: input.topicId },
      {
        postProcessUrl: (path, file) => fileService.getFileAccessUrl({ id: file.id, url: path }),
        redaction: {
          showErrorDetails: share.shareConfig.showErrorDetails,
          showModelInfo: share.shareConfig.showModelInfo,
        },
      },
    );
  }),

  /** The visitor's own topics on this shared agent. */
  getTopics: shareChatProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      // The list is intentionally NOT bounded by the share's live
      // `maxTopicsPerVisitor`: that cap gates ADMISSION of new topics (the
      // COUNT check in `execAgent` above), and a creator may lower it below
      // what a visitor already created. Tying the page size to it would hide
      // those older conversations with no pagination or deep link to reach
      // them, so the model applies its own fixed, generous list bound instead.
      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      return topicModel.queryBySender({
        agentId: share.agentId,
        senderId: ctx.userId,
      });
    }),

  /**
   * Interrupt a running share operation — the visitor counterpart of
   * `aiAgent.interruptTask`. Visitors have no owner-scoped access to
   * `aiAgent.interruptTask` (its models are scoped to the caller, and share
   * runs execute under the CREATOR's identity), so without this endpoint a
   * visitor's Stop / tab-close cannot reach the server: the run keeps streaming
   * and consuming the creator's budget until it finishes on its own.
   *
   * Authorization is intentionally stricter than `execAgent`/`getMessages`;
   * see {@link authorizeVisitorRunningOperation}.
   */
  interruptTask: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { aiAgentService, share } = await authorizeVisitorRunningOperation(
        ctx.serverDB,
        ctx.userId,
        input,
      );

      log(
        'interruptTask: share=%s visitor=%s topic=%s operation=%s',
        input.shareId,
        ctx.userId,
        input.topicId,
        input.operationId,
      );

      try {
        return await aiAgentService.interruptTask({
          operationId: input.operationId,
          topicId: input.topicId,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('interruptTask', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),

  /**
   * The visitor counterpart of `aiAgent.setQueuedMessages`: a visitor can queue
   * follow-ups behind a share run too, and needs the same early hand-back.
   * Authorized exactly like `interruptTask`.
   */
  setQueuedMessages: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string(), pending: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { aiAgentService, share } = await authorizeVisitorRunningOperation(
        ctx.serverDB,
        ctx.userId,
        input,
      );

      log(
        'setQueuedMessages: share=%s visitor=%s topic=%s operation=%s pending=%s',
        input.shareId,
        ctx.userId,
        input.topicId,
        input.operationId,
        input.pending,
      );

      try {
        return await aiAgentService.setQueuedMessages({
          operationId: input.operationId,
          pending: input.pending,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('setQueuedMessages', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),

  /**
   * Mint the per-VISITOR Gateway JWT for the multiplexed v2 WebSocket — the
   * visitor counterpart of `aiAgent.issueGatewayUserToken`. Same subject rule
   * as `refreshGatewayToken` (sign for the visitor: share ops register their
   * stream under `streamOwnerUserId = visitor`, and the hub keys on the JWT
   * `sub`), but without a running-operation check: the token authenticates the
   * user hub socket, and each `subscribe` is authorized per op by the gateway.
   * The share must still resolve as link-visible for this caller so a revoked
   * or private share cannot be used to open a hub socket from its page.
   */
  issueGatewayUserToken: shareChatProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }) => {
      await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),

  /**
   * Refresh the Gateway WS JWT for a running share operation — the visitor
   * counterpart of `aiAgent.refreshGatewayToken` (which cannot serve visitors:
   * its TopicModel is scoped to the caller, and share topics belong to the
   * creator). Signs for the VISITOR — the gateway channel is registered under
   * their id (`streamOwnerUserId`), and a creator-signed token in the visitor's
   * browser would be creator account access.
   */
  refreshGatewayToken: shareChatProcedure
    .input(ShareTopicScopeSchema)
    .query(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const topicModel = new TopicModel(ctx.serverDB, share.ownerId, undefined, undefined, {
        includeShareVisitor: true,
      });
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      // A present marker is not proof of a live run: it is cleared best-effort
      // at finish, so a stale one would send the visitor's browser to reconnect
      // to a finished operation, register it as "running" locally, and drop the
      // topic's fetched history as in-flight noise (a frozen skeleton list).
      // NOT_FOUND is what the client already treats as "stale marker, clear it".
      const runningOperation = topic.metadata?.runningOperation;
      if (
        !runningOperation ||
        !(await topicModel.isRunningOperationAlive(ctx.serverDB, runningOperation))
      ) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),

  /**
   * Drop a share upload the visitor removed from their draft before sending.
   * Only the uploading visitor's own share files qualify (provenance check),
   * and only while no message references the row — once sent, the attachment
   * is part of a creator-owned conversation and stays put.
   *
   * `exclusiveStorage`: share rows are created outside `global_files` (see
   * `createFile`), so the row's `url` is the only reference to its object and
   * the object goes whenever the row does.
   */
  removeFile: shareChatProcedure
    .input(z.object({ fileId: z.string().min(1).max(64), shareId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const fileModel = new FileModel(ctx.serverDB, share.ownerId);
      const existing = await fileModel.findById(input.fileId);
      const provenance = shareFileProvenance(existing);
      if (provenance?.shareId !== share.shareId || provenance.visitorUserId !== ctx.userId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      const file = await fileModel.deleteUnreferenced(
        input.fileId,
        serverDBEnv.REMOVE_GLOBAL_FILE,
        {
          exclusiveStorage: true,
        },
      );
      if (!file) return;

      await new FileService(ctx.serverDB, share.ownerId).deleteFile(file.url!);
    }),
});

export type ShareChatRouter = typeof shareChatRouter;
