import { z } from 'zod';

import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertAgentShareVisitorEnabled } from '../_helpers/agentShareFeatureGate';

/**
 * Visitor-facing execution chain for shared agents (Agent Share).
 *
 * All procedures authenticate the VISITOR (ctx.userId) but operate on rows in
 * the Agent's owning scope: topics/messages carry the creator's userId plus the
 * Agent's workspaceId when present, and `topics.senderId = visitor` for
 * scoping. Every
 * read/write here is therefore manually authorized: resolve the share via
 * {@link resolveLinkShareOrThrow}, then require
 * `topic.senderId === visitor && topic.agentId === share.agentId`
 * ({@link findVisitorTopicOrThrow}).
 *
 * A visitor topic is tied to its share through `(agentId, senderId)`. Turning
 * sharing off and back on keeps the same share row, so that visitor's older
 * conversations remain available and continue counting toward the topic cap.
 *
 * Workspace identity is resolved from the share row, never from visitor
 * headers, and is threaded through every model/service that persists data or
 * invokes the runtime.
 */
export const shareChatProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  // Visitor access depends on deployment support and share permissions,
  // not the publishing rollout flag.
  assertAgentShareVisitorEnabled();

  return opts.next();
});

export const ShareTopicScopeSchema = z.object({
  shareId: z.string(),
  topicId: z.string(),
});
