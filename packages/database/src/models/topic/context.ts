import type { SQL } from 'drizzle-orm';
import { and, eq, isNull, or } from 'drizzle-orm';

import type { FtsSearchCandidateSource } from '../../repositories/ftsSearch';
import { messages, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { TopicKeywordScope } from './types';

/**
 * The state and scope predicates every `TopicModel` operation shares. Built once
 * per model instance; the operation modules receive it as their first argument.
 */
export interface TopicModelContext {
  db: LobeChatDatabase;
  ftsSearchCandidateSource?: FtsSearchCandidateSource;
  genId: () => string;
  /**
   * When true, {@link TopicModelContext.ownership} (and by extension every
   * creator-scoped read path) stops ANDing {@link notShareVisitorTopic}.
   * Reserved for surfaces that are share-runtime by design (agent-share visitor
   * router, share-scoped abuse guards) and for the agent runtime paths that
   * persist or clean up a visitor turn under the CREATOR's identity. Defaults
   * to false so every ordinary creator-facing caller fails closed instead of
   * relying on a per-callsite `notShareVisitorTopic()` AND.
   */
  includeShareVisitor: boolean;
  matchContainer: (containerId?: string | null) => SQL | undefined;
  matchGroup: (groupId?: string | null) => SQL;
  matchKeywordScope: (scope: TopicKeywordScope) => SQL | undefined;
  matchSession: (sessionId?: string | null) => SQL;
  messageOwnership: () => SQL | undefined;
  mine: () => SQL | undefined;
  notShareVisitor: () => SQL | undefined;
  ownership: () => SQL | undefined;
  trashScope: () => SQL | undefined;
  userId: string;
  workspaceId?: string;
  workspaceScope: () => SQL | undefined;
}

export const createTopicModelContext = ({
  db,
  ftsSearchCandidateSource,
  includeShareVisitor,
  userId,
  workspaceId,
}: Pick<
  TopicModelContext,
  'db' | 'ftsSearchCandidateSource' | 'includeShareVisitor' | 'userId' | 'workspaceId'
>): TopicModelContext => {
  const ctx: TopicModelContext = {
    db,
    ftsSearchCandidateSource,
    includeShareVisitor,
    userId,
    workspaceId,

    /**
     * Raw workspace/user scope, WITHOUT the visitor exclusion. Backing store for
     * both {@link ownership} and {@link mine}, and the escape hatch for methods
     * that must see visitor rows independent of the instance flag
     * ({@link queryBySender} / {@link countBySender} / {@link countShareVisitors}).
     */
    workspaceScope: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, topics),

    /**
     * {@link workspaceScope} without the recycle-bin filter, still excluding
     * share-visitor topics — restore / trash lookups / purge internals only.
     */
    trashScope: () =>
      and(
        buildWorkspaceWhere(
          { includeTrashed: true, userId: ctx.userId, workspaceId: ctx.workspaceId },
          topics,
        ),
        ctx.notShareVisitor(),
      ),

    ownership: () => and(ctx.workspaceScope(), ctx.notShareVisitor()),

    /**
     * In workspace mode `ownership()` matches every member's topics, so a bulk
     * "clear all" would wipe teammates' conversations. Destructive sweeps must
     * additionally pin `user_id` to the caller (personal mode is unchanged —
     * ownership already scopes to the user there).
     *
     * `mine()` deliberately does NOT AND {@link notShareVisitor} — it is the
     * per-user variant of {@link workspaceScope} and the share-scoped methods
     * ({@link queryBySender} / {@link countBySender} / {@link countShareVisitors})
     * layer their own `senderId` predicate on top of it. Creator-facing
     * destructive sweeps that reach for `mine()` still get the visitor
     * exclusion by AND-ing {@link notShareVisitor} themselves.
     */
    mine: () => and(ctx.workspaceScope(), eq(topics.userId, ctx.userId)),

    messageOwnership: () =>
      buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, messages),

    /**
     * The default visitor exclusion applied by {@link ownership}: `topics.senderId IS NULL`,
     * shared with the repositories/models that query `topics` outside this
     * class (see `notShareVisitorTopic` in `../utils/shareVisitor`). Returns
     * `undefined` when the instance was constructed with `includeShareVisitor:
     * true`, so the share runtime opts in explicitly and every other caller
     * gets the visitor guard for free.
     *
     * The visitor-scoped counterparts ({@link queryBySender}, {@link countBySender})
     * intentionally do the opposite — they match on `senderId`, not exclude
     * it — and use {@link mine} (which skips this helper).
     */
    notShareVisitor: () => (ctx.includeShareVisitor ? undefined : notShareVisitorTopic()),

    genId: () => idGenerator('topics'),

    matchSession: (sessionId?: string | null) =>
      sessionId ? eq(topics.sessionId, sessionId) : isNull(topics.sessionId),

    matchGroup: (groupId?: string | null) =>
      groupId ? eq(topics.groupId, groupId) : isNull(topics.groupId),

    matchContainer: (containerId?: string | null) => {
      if (containerId)
        return or(eq(topics.sessionId, containerId), eq(topics.groupId, containerId));
      // If neither is provided, match topics with no session or group
      return and(isNull(topics.sessionId), isNull(topics.groupId));
    },

    /**
     * Build the WHERE condition that scopes a keyword search to a single
     * conversation owner. Mirrors {@link TopicModel.query}'s precedence and
     * conditions exactly (groupId > agentId > containerId), so search returns the
     * same set the topics list shows.
     *
     * The agent branch matches `topics.agentId` directly — the new agent system
     * stamps every topic with an agentId, and the old `matchContainer` path
     * (sessionId / groupId only) would miss those rows entirely. It deliberately
     * does NOT fall back to the resolved sessionId: the list has no such fallback
     * either, so adding one would (a) surface un-migrated rows the list hides and
     * (b) leak topics owned by another agent that shares the same session mapping.
     * Legacy rows are backfilled with an agentId by the migration the list query
     * triggers, after which the agentId match finds them.
     */
    matchKeywordScope: ({ agentId, containerId, groupId }: TopicKeywordScope): SQL | undefined => {
      if (groupId) return eq(topics.groupId, groupId);
      if (agentId) return eq(topics.agentId, agentId);
      return ctx.matchContainer(containerId);
    },
  };

  return ctx;
};
