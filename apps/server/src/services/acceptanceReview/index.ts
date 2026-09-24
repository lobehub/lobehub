import { randomUUID } from 'node:crypto';

import type { AcceptanceCommentItem, AcceptanceCommentSource } from '@lobechat/types';
import { FileSource } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { acceptances } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { isUuid } from '@/database/utils/uuid';
import { createContextInner } from '@/libs/trpc/lambda/context';
import {
  type AcceptanceReviewCapability,
  type AcceptanceReviewJwtClaims,
  signAcceptanceReviewJWT,
} from '@/libs/trpc/utils/internalJwt';
import { resolveAcceptanceCommentAccess } from '@/server/routers/lambda/_helpers/acceptanceCommentAccess';
import { canManageAcceptance } from '@/server/routers/lambda/_helpers/acceptanceWriteScope';
import { acceptanceRouter } from '@/server/routers/lambda/acceptance';
import { acceptanceCommentRouter } from '@/server/routers/lambda/acceptanceComment';
import { FileService } from '@/server/services/file';

/** How long a review session lasts before the toolbar asks the reviewer again. */
export const ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS = 60 * 60;

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

/**
 * The web origin a review toolbar may run on, normalized — or null when it is
 * not one a person could have meant to approve. Plain http is refused except on
 * loopback, where local development of the product runs.
 */
export function normalizeReviewOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin === 'null' || url.username || url.password) return null;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  return url.origin;
}

async function loadAcceptance(db: LobeChatDatabase, acceptanceId: string) {
  const [acceptance] = isUuid(acceptanceId)
    ? await db.select().from(acceptances).where(eq(acceptances.id, acceptanceId)).limit(1)
    : [];
  if (!acceptance) throw new TRPCError({ code: 'NOT_FOUND', message: 'Acceptance not found' });
  return acceptance;
}

/** What the reviewer may do on this acceptance, as the approval page shows it. */
async function capabilitiesOf(db: LobeChatDatabase, userId: string, acceptanceId: string) {
  const access = await resolveAcceptanceCommentAccess(db, userId, acceptanceId);
  const capabilities: AcceptanceReviewCapability[] = [];
  if (access.canComment) capabilities.push('comment');
  if (await canManageAcceptance({ serverDB: db, userId }, access.acceptance))
    capabilities.push('reject');
  return { acceptance: access.acceptance, capabilities };
}

const titleOf = (acceptance: { metadata: unknown; requirement: string | null }) =>
  ((acceptance.metadata as { title?: string } | null)?.title ?? acceptance.requirement ?? '').slice(
    0,
    200,
  );

/** The approval page's read: which delivery, which site, and what the session would allow. */
export async function describeReviewConnect(
  db: LobeChatDatabase,
  userId: string,
  input: { acceptanceId: string; origin: string },
) {
  const origin = normalizeReviewOrigin(input.origin);
  if (!origin) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid origin' });
  const { acceptance, capabilities } = await capabilitiesOf(db, userId, input.acceptanceId);
  return {
    acceptance: { id: acceptance.id, status: acceptance.status, title: titleOf(acceptance) },
    capabilities,
    origin,
  };
}

/**
 * The reviewer approved the site: mint a session bound to this acceptance and
 * this origin. Capabilities are recomputed here, never taken from the page.
 */
export async function authorizeReviewConnect(
  db: LobeChatDatabase,
  userId: string,
  input: { acceptanceId: string; origin: string },
) {
  const described = await describeReviewConnect(db, userId, input);
  if (!described.capabilities.length)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot review this acceptance' });
  const token = await signAcceptanceReviewJWT({
    acceptanceId: described.acceptance.id,
    capabilities: described.capabilities,
    expiration: `${ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS}s`,
    origin: described.origin,
    userId,
  });
  return {
    ...described,
    expiresAt: new Date(Date.now() + ACCEPTANCE_REVIEW_TOKEN_TTL_SECONDS * 1000).toISOString(),
    token,
  };
}

/** A review toolbar's remark as the toolbar shows it back. */
export interface ReviewAnnotation {
  attachments: AcceptanceCommentItem['attachments'];
  content: string;
  createdAt: Date;
  id: string;
  source: AcceptanceCommentSource | null;
}

const toAnnotation = (item: AcceptanceCommentItem): ReviewAnnotation => ({
  attachments: item.attachments,
  content: item.content,
  createdAt: item.createdAt,
  id: item.id,
  source: item.source,
});

function decodeScreenshot(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([\d+/=A-Za-z]+)$/.exec(dataUrl);
  if (!match)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Screenshot must be a png, jpeg or webp data URL',
    });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength > MAX_SCREENSHOT_BYTES)
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Screenshot is too large' });
  return {
    buffer,
    extension: match[1] === 'image/jpeg' ? 'jpg' : match[1].slice(6),
    mimeType: match[1],
  };
}

/**
 * Everything a review toolbar does, as the reviewer who approved it. Each call
 * goes through the same tRPC procedure the viewer uses — access checks, rate
 * limits and the reject send-back are not re-implemented here — with the
 * session's acceptance pinned, so the toolbar can never address another one.
 */
export class AcceptanceReviewSession {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly claims: AcceptanceReviewJwtClaims,
  ) {}

  private can(capability: AcceptanceReviewCapability) {
    if (!this.claims.capabilities.includes(capability))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This review session cannot ${capability}`,
      });
  }

  private async callers() {
    const acceptance = await loadAcceptance(this.db, this.claims.acceptance_id);
    const ctx = await createContextInner({
      userId: this.claims.sub,
      workspaceId: acceptance.workspaceId,
    });
    return {
      acceptance,
      acceptanceCaller: acceptanceRouter.createCaller(ctx),
      commentCaller: acceptanceCommentRouter.createCaller(ctx),
    };
  }

  async describe() {
    const { acceptance } = await this.callers();
    return {
      acceptance: { id: acceptance.id, status: acceptance.status, title: titleOf(acceptance) },
      capabilities: this.claims.capabilities,
      expiresAt: new Date(this.claims.exp * 1000).toISOString(),
    };
  }

  /** The reviewer's own open remarks from product pages — the toolbar's drafts. */
  async listMine(): Promise<ReviewAnnotation[]> {
    const { commentCaller } = await this.callers();
    const { items } = await commentCaller.list({ acceptanceId: this.claims.acceptance_id });
    return items
      .filter(
        (item) =>
          item.authorUserId === this.claims.sub &&
          item.source &&
          !item.parentCommentId &&
          !item.resolvedAt &&
          !item.deletedAt,
      )
      .map(toAnnotation);
  }

  async create(input: {
    clientId?: string;
    content: string;
    screenshot?: string | null;
    source: AcceptanceCommentSource;
  }) {
    this.can('comment');
    const { acceptance, commentCaller } = await this.callers();

    let attachments: { fileId: string }[] | undefined;
    if (input.screenshot) {
      const { buffer, extension, mimeType } = decodeScreenshot(input.screenshot);
      const workspaceId = acceptance.workspaceId ?? undefined;
      const pathname = `acceptance-review/${this.claims.sub}/${randomUUID()}.${extension}`;
      const { fileId } = await new FileService(
        this.db,
        this.claims.sub,
        workspaceId,
      ).uploadFromBuffer(
        buffer,
        mimeType,
        pathname,
        (transaction) =>
          businessFileUploadCheck({
            actualSize: buffer.length,
            inputSize: buffer.length,
            transaction,
            url: pathname,
            userId: this.claims.sub,
            workspaceId: acceptance.workspaceId,
          }),
        { source: FileSource.Acceptance, visibility: 'private' },
      );
      attachments = [{ fileId }];
    }

    const { data } = await commentCaller.create({
      acceptanceId: this.claims.acceptance_id,
      attachments,
      clientId: input.clientId ?? randomUUID(),
      content: input.content,
      source: input.source,
    });
    return toAnnotation(data);
  }

  async remove(commentId: string) {
    this.can('comment');
    const { commentCaller } = await this.callers();
    const mine = (await this.listMine()).some((item) => item.id === commentId);
    // Only the reviewer's own product remarks: the toolbar is not a moderation tool.
    if (!mine) throw new TRPCError({ code: 'NOT_FOUND', message: 'Remark not found' });
    await commentCaller.delete({ id: commentId });
    return { id: commentId };
  }

  /** Send the delivery back; the reject procedure dispatches the repair to its source agent. */
  async reject(input: { comment?: string }) {
    this.can('reject');
    const { acceptanceCaller } = await this.callers();
    const result = await acceptanceCaller.reject({
      comment: input.comment,
      id: this.claims.acceptance_id,
    });
    return { repairDispatch: result.repairDispatch, status: result.status };
  }
}
