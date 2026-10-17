import type { ChatMessageError } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentShareModel } from '@/database/models/agentShare';
import { sanitizeVisitorError } from '@/database/models/message';
import type { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:router:shareChat');

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
export const resolveLinkShareOrThrow = async (
  db: LobeChatDatabase,
  shareId: string,
  viewerId: string,
) => {
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
export const findVisitorTopicOrThrow = async (
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
export const toVisitorSafeStartupError = (
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
