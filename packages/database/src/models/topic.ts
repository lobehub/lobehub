import { AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT } from '@lobechat/const';
import type {
  ChatTopicMetadata,
  ChatTopicStatus,
  DBMessageItem,
  TopicQuerySortBy,
  TopicRankItem,
  TopicScheduledRun,
} from '@lobechat/types';
import type { TimingSink } from '@lobechat/utils';
import {
  getDurationMs,
  logTimingSink as logTiming,
  runTimedSinkStage as runTimedStage,
} from '@lobechat/utils';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';

import { clampToolIdentifier } from '@/utils/clampToolIdentifier';

import type { FtsSearchCandidateSource } from '../repositories/ftsSearch';
import type { TopicItem } from '../schemas';
import {
  agentOperations,
  agents,
  messagePlugins,
  messages,
  threads,
  topicDocuments,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { sanitizeBm25Query } from '../utils/bm25';
import { COPIED_TOPIC_USAGE_RESET } from '../utils/copiedTranscript';
import { markCopiedMessageMetadata } from '../utils/copyMessagesInDatabase';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';
import { inJsonStringArray } from '../utils/inJsonStringArray';
import { notShareVisitorTopic } from '../utils/shareVisitor';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { recomputeTopicUsage } from './topicUsage';

type OnboardingSessionMetadataPatch = Partial<NonNullable<ChatTopicMetadata['onboardingSession']>>;
type TopicMetadataPatch = Omit<Partial<ChatTopicMetadata>, 'onboardingSession'> & {
  onboardingSession?: OnboardingSessionMetadataPatch;
};

/**
 * How much of the last assistant reply `queryTopics` ships to a list view. Long
 * enough that a run summary arrives whole, short enough that 200 rows of raw
 * markdown never do — anything past it is marked with an ellipsis, and the full
 * text is one click away in the topic itself.
 */
const LAST_MESSAGE_PREVIEW_LENGTH = 2000;
const TASK_CALLBACK_RESERVATION_TTL_MS = 5 * 60 * 1000;
/**
 * How long an operation that still claims `running` / `idle` may hold the topic
 * against a background start before it is treated as abandoned.
 *
 * Only a backstop for the case the operation row cannot describe: a process
 * killed mid-run leaves its row at `running` forever, and every marker clear
 * site is best-effort (`ServerOperationStore.clearRunningMark` swallows
 * failures; the gateway client clears it from `onSessionComplete`, which never
 * runs if the tab closed). Runs parked on a human or an async tool are exempt —
 * those legitimately last days — so this only has to be longer than a plausible
 * uninterrupted generation. The real reaper remains the gateway watchdog's
 * `finalize-abandoned` call.
 */
const ABANDONED_OPERATION_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Operation statuses that mean "this run is still the topic's owner". Parked
 * states are included on purpose: a run waiting for approval is not stuck.
 */
const LIVE_OPERATION_STATUSES = new Set([
  'idle',
  'running',
  'waiting_for_human',
  'waiting_for_async_tool',
]);
/** Parked states are exempt from the abandoned-age backstop — see above. */
const UNBOUNDED_OPERATION_STATUSES = new Set(['waiting_for_human', 'waiting_for_async_tool']);

export interface TopicListItem extends TopicItem {
  /** The topic's last non-empty assistant reply, truncated with a trailing `…`. Only set when `queryTopics` is called with `withLastMessage`. */
  lastAssistantMessage?: string | null;
  /**
   * When the topic's current run started (`agent_operations.startedAt` of its
   * latest top-level running operation). Only computed for `running` topics;
   * null for everything else, and for runs that never wrote an operation row
   * (e.g. client-mode runs) — callers must keep a fallback.
   */
  runStartedAt?: Date | null;
}

/**
 * Sanitized projection of `topics.metadata.runningOperation` for a visitor DTO
 * — only the fields `useGatewayReconnect`'s `RunningOperation` needs to resume
 * a streaming session on reload. Never the full `runningOperation` object: it
 * also carries device/hetero fields (`deviceId`, `deviceUserId`, `hooks`, …)
 * that describe creator-side dispatch and must not reach a visitor.
 */
export interface VisitorRunningOperation {
  assistantMessageId: string;
  heteroType?: string | null;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

/**
 * Visitor-facing topic DTO for the agent-share surface. Deliberately narrow:
 * the underlying row is CREATOR-owned and also carries the creator's userId,
 * model/provider snapshot, cost/usage and internal metadata.
 */
export interface VisitorTopicItem {
  createdAt: Date;
  id: string;
  /**
   * Sanitized `runningOperation` marker, present only while a run is active on
   * this topic. Lets the share surface reconnect a Gateway stream after a page
   * reload — see {@link VisitorRunningOperation} for why it's projected
   * instead of forwarding `topics.metadata.runningOperation` as-is.
   */
  runningOperation?: VisitorRunningOperation | null;
  title: string | null;
  updatedAt: Date;
}

/**
 * Fallback page size for {@link TopicModel.queryBySender} when a caller
 * doesn't pass one. Pinned to the package default per-visitor topic cap.
 *
 * Callers with a live share config (e.g. `shareChat.getTopics`) MUST pass the
 * share's actual resolved `maxTopicsPerVisitor` as `pageSize` instead of
 * relying on this default — a creator who raises the cap above the default
 * would otherwise have a visitor's list silently truncated below what that
 * visitor is actually allowed to create.
 */
const VISITOR_TOPIC_PAGE_SIZE = AGENT_SHARE_VISITOR_TOPIC_LIST_LIMIT;

/**
 * Projects `topics.metadata.runningOperation` down to the visitor-safe subset
 * — see {@link VisitorRunningOperation}. Used by {@link TopicModel.queryBySender}
 * so a share visitor's topic list can drive `useGatewayReconnect` without ever
 * receiving the rest of `metadata` (creator-only fields — see the module doc).
 */
const pickVisitorRunningOperation = (
  metadata: ChatTopicMetadata | null | undefined,
): VisitorRunningOperation | null => {
  const runningOperation = metadata?.runningOperation;
  if (!runningOperation) return null;

  const { assistantMessageId, operationId, scope, threadId, heteroType } = runningOperation;
  return { assistantMessageId, heteroType, operationId, scope, threadId };
};

export interface CreateTopicParams {
  agentId?: string | null;
  favorite?: boolean;
  groupId?: string | null;
  messages?: string[];
  metadata?: ChatTopicMetadata;
  /** Pinned model snapshot, persisted to the top-level `topics.model` column. */
  model?: string | null;
  provider?: string | null;
  /**
   * Agent-share visitor topics carry the CREATOR's `userId` (billing/data
   * attribution) plus the visitor's id here, so creator-facing listings
   * exclude them (`notShareVisitorTopic`, applied by `query`, `count`,
   * `queryTopics`, `queryRecent` and `rank`) while the share surface scopes
   * reads per visitor (`queryBySender` / `countBySender`).
   *
   * A future opt-in surface (`allowCreatorViewSessions`) may let a creator
   * explicitly browse visitor sessions; that is not wired up yet — every
   * creator-facing read today unconditionally excludes senderId rows.
   */
  senderId?: string | null;
  sessionId?: string | null;
  /**
   * Initial status. Defaults to the column default (`active`). A topic created
   * with `metadata.scheduledRun` must set `scheduled` here so the status and the
   * payload land in the same insert — the dispatcher treats the pair as one fact.
   */
  status?: ChatTopicStatus;
  title?: string;
  trigger?: string | null;
}

interface QueryTopicParams {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Kept for backward compatibility.
   * Container ID (sessionId or groupId) to filter topics by
   */
  containerId?: string | null;
  current?: number;
  /**
   * Restrict an `agentId` query to the builder conversations that configured
   * one specific target (`metadata.editingAgentId` / `metadata.editingGroupId`).
   *
   * Builder panels run on a single builtin agent shared by every target, whose
   * topics deliberately carry no `groupId` / `sessionId` — those columns mark a
   * topic as part of the target's own chat read path. The builder panel itself
   * shows the unfiltered history on purpose; these exist so a caller that wants
   * one target's builds can ask for them. Only meaningful alongside `agentId`;
   * ignored by the group / container branches.
   */
  editingAgentId?: string | null;
  editingGroupId?: string | null;
  /**
   * Exclude topics by status (e.g. ['completed'])
   */
  excludeStatuses?: string[];
  /**
   * Exclude topics by trigger types (e.g. ['cron'])
   * Ignored when includeTriggers is provided.
   */
  excludeTriggers?: string[];
  /**
   * Group ID to filter topics by
   */
  groupId?: string | null;
  /**
   * Include only topics whose trigger matches one of these values.
   * Takes precedence over excludeTriggers when provided.
   */
  includeTriggers?: string[];
  /**
   * Whether this is an inbox agent query.
   * When true, also includes legacy inbox topics (sessionId IS NULL AND groupId IS NULL AND agentId IS NULL)
   */
  isInbox?: boolean;
  pageSize?: number;
  /**
   * Server-side ordering. Defaults to `updatedAt`. `status` orders by status
   * priority (see `STATUS_SORT_RANK`) so the sidebar "group by status" mode
   * keeps high-priority topics on the first page.
   */
  sortBy?: TopicQuerySortBy;
  timing?: ModelTimingContext;
  /**
   * Include only topics matching the given trigger types (positive filter)
   */
  triggers?: string[];
  /**
   * When true, the SELECT also returns the heavier card-detail columns used
   * by the per-agent Topics management page: `firstUserMessage` (subquery),
   * `messageCount` (subquery), `description`, `trigger`. `cost` and
   * `tokenUsage` are intentionally omitted until a dedicated schema migration
   * adds real columns to back them. Defaults to false so sidebar paths stay
   * cheap.
   */
  withDetails?: boolean;
}

export interface ModelTimingContext extends TimingSink {}

/**
 * Scope used to constrain a keyword search to a single conversation owner.
 * Mirrors the precedence of {@link TopicModel.query}: groupId > agentId >
 * containerId (legacy sessionId / groupId).
 */
export interface TopicKeywordScope {
  agentId?: string | null;
  /**
   * @deprecated Use agentId or groupId instead. Only consulted when neither
   * agentId nor groupId is provided (legacy / mobile string-arg callers).
   * Container ID (sessionId or groupId) to filter topics by.
   */
  containerId?: string | null;
  groupId?: string | null;
}

export interface ListTopicsForMemoryExtractorCursor {
  createdAt: Date;
  id: string;
}

// Status priority for the sidebar "group by status" ordering. Lower rank =
// higher in the list. A NULL / unknown status falls through to `active` (3),
// matching the client which treats a missing status as active. Keep this in
// sync with `STATUS_GROUP_ORDER` / `resolveStatusBucket` in `@lobechat/utils`
// (client-side bucketing): `waitingForHuman`, `failed` and `unread` all collapse
// into the top `pending` bucket, so they must float to the top here too —
// otherwise such a topic could fall off the first page and vanish from the
// pending group.
const STATUS_SORT_RANK = sql`CASE ${topics.status}
  WHEN 'waitingForHuman' THEN 0
  WHEN 'failed' THEN 1
  WHEN 'unread' THEN 2
  WHEN 'running' THEN 3
  WHEN 'scheduled' THEN 4
  WHEN 'active' THEN 5
  WHEN 'completed' THEN 6
  WHEN 'archived' THEN 7
  ELSE 5 END`;

// Favorites always float to the top; the rest are ordered by the requested
// strategy. `status` adds the priority bucket before the recency tiebreaker.
const buildTopicOrderBy = (topicActivityAt: SQL, sortBy?: TopicQuerySortBy): SQL[] =>
  sortBy === 'status'
    ? [desc(topics.favorite), asc(STATUS_SORT_RANK), desc(topicActivityAt)]
    : [desc(topics.favorite), desc(topicActivityAt)];

/**
 * NEVER null-test a jsonb arrow / path expression inside a WHERE clause:
 *
 * ```sql
 * (metadata ->> 'cronJobId')          IS NULL          -- 💥
 * (metadata #>> '{a,b}')              IS NOT NULL      -- 💥
 * ```
 *
 * The crash is `pg_search`'s (ParadeDB BM25) planner hook, and it fires on any
 * table carrying a `bm25` index: `rt_fetch used out-of-bounds`, SQLSTATE XX000.
 * Drizzle reports it as a bare `Failed query:`, with the real cause only in the
 * driver's `[cause]`. Four properties make it uniquely nasty:
 *
 * - It fires at PLAN time. `EXPLAIN` alone crashes, so a table with zero
 *   matching rows crashes exactly like a full one.
 * - Stock Postgres, PGlite, and any table *without* a bm25 index run these
 *   predicates happily — no test we can write will ever catch it.
 * - It has nothing to do with jsonb. `upper(col) IS NULL` and `(id + 1) IS NULL`
 *   crash identically; the trigger is a null test over a *computed expression*
 *   in a qual. A null test over a bare column is fine.
 * - Only quals crash — WHERE, JOIN ON, HAVING, and the WHERE of a subquery, CTE,
 *   UPDATE or DELETE. SELECT lists, ORDER BY and `UPDATE … SET` targets are safe.
 *
 * `topics` and `messages` carry bm25 indexes today, but so do `agents`, `files`,
 * `documents`, `chat_groups`, `knowledge_bases` and every `user_memories*`
 * table — and that list is one migration away from growing. A predicate written
 * today outlives the index list, so the rule is table-independent: never write
 * the shape.
 *
 * COALESCE the extracted value to a sentinel instead — same semantics, a shape
 * the planner survives:
 *
 * ```sql
 * COALESCE(metadata ->> 'cronJobId', '') = ''                     -- "is null"
 * COALESCE((metadata #>> '{a,b}')::numeric, 0) <= $1              -- numeric gate
 * COALESCE(metadata ->> 'status', '') <> 'done'                   -- IS DISTINCT FROM
 * ```
 *
 * (`IS DISTINCT FROM` measured safe on pg_search 0.15.26, but the guard bans it
 * anyway — it sits one planner-hook change from the crashing family and the
 * COALESCE form costs nothing.)
 *
 * This has now bitten three times: #13040, `getLatestSpineMessageId` (#16693)
 * and `getDueScheduledTopics` (#17077 — the scheduled-run cron crashed on every
 * tick from the day it shipped, so rate-limit continuations never once resumed).
 * `jsonbNullTest.test.ts` is the source-shape guard that holds the line.
 */
export interface TopicModelOptions {
  /**
   * Opt IN to agent-share visitor topics. Visitor conversations persist under
   * the CREATOR's `userId` (only `topics.senderId` marks them), so every
   * creator-facing read/write is default-scoped to exclude them. Only the
   * share-runtime surfaces (share-scoped tRPC routers, share abuse guards,
   * and the agent runtime paths that persist or clean up a visitor turn
   * under the creator's identity) should set this to `true`.
   */
  includeShareVisitor?: boolean;
}

export class TopicModel {
  private userId: string;
  private db: LobeChatDatabase;
  private ftsSearchCandidateSource?: FtsSearchCandidateSource;
  private workspaceId?: string;
  /**
   * When true, {@link ownership} (and by extension every creator-scoped read
   * path below) stops ANDing {@link notShareVisitorTopic}. Reserved for
   * surfaces that are share-runtime by design (agent-share visitor router,
   * share-scoped abuse guards) and for the agent runtime paths that persist
   * or clean up a visitor turn under the CREATOR's identity. Defaults to
   * false so every ordinary creator-facing caller fails closed instead of
   * relying on a per-callsite `notShareVisitorTopic()` AND.
   */
  private includeShareVisitor: boolean;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
    options: TopicModelOptions = {},
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.ftsSearchCandidateSource = ftsSearchCandidateSource;
    this.includeShareVisitor = options.includeShareVisitor ?? false;
  }

  /**
   * Raw workspace/user scope, WITHOUT the visitor exclusion. Backing store for
   * both {@link ownership} and {@link mine}, and the escape hatch for methods
   * that must see visitor rows independent of the instance flag
   * ({@link queryBySender} / {@link countBySender} / {@link countVisitors}).
   */
  private workspaceScope = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics);

  private ownership = () => and(this.workspaceScope(), this.notShareVisitor());

  /**
   * In workspace mode `ownership()` matches every member's topics, so a bulk
   * "clear all" would wipe teammates' conversations. Destructive sweeps must
   * additionally pin `user_id` to the caller (personal mode is unchanged —
   * ownership already scopes to the user there).
   *
   * `mine()` deliberately does NOT AND {@link notShareVisitor} — it is the
   * per-user variant of {@link workspaceScope} and the share-scoped methods
   * ({@link queryBySender} / {@link countBySender} / {@link countVisitors})
   * layer their own `senderId` predicate on top of it. Creator-facing
   * destructive sweeps that reach for `mine()` still get the visitor
   * exclusion by AND-ing {@link notShareVisitor} themselves.
   */
  private mine = () => and(this.workspaceScope(), eq(topics.userId, this.userId));

  private messageOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);

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
  private notShareVisitor = () => (this.includeShareVisitor ? undefined : notShareVisitorTopic());
  // **************** Query *************** //

  query = async ({
    agentId,
    containerId,
    current = 0,
    editingAgentId,
    editingGroupId,
    excludeStatuses,
    excludeTriggers,
    includeTriggers,
    pageSize = 9999,
    groupId,
    isInbox,
    sortBy,
    timing,
    triggers,
    withDetails = false,
  }: QueryTopicParams = {}) => {
    const queryStartedAt = Date.now();
    logTiming(timing, 'db.topic.query:start', {
      current,
      hasAgentId: !!agentId,
      hasContainerId: !!containerId,
      hasGroupId: !!groupId,
      isInbox: !!isInbox,
      pageSize,
      withDetails,
    });
    const offset = current * pageSize;

    // Heavier columns gated behind `withDetails` and used by the per-agent
    // Topics management page: real aggregates from the `messages` table
    // (firstUserMessage + messageCount), plus the `description` / `trigger`
    // columns that sidebar paths don't consume. `cost` and `tokenUsage`
    // intentionally stay undefined here — they need their own schema
    // migration before they can be backed by real numbers.
    //
    // The two correlated subqueries are built with Drizzle's query builder
    // (not a raw `sql` template) so the inner `eq(messages.topicId,
    // topics.id)` renders as `"messages"."topic_id" = "topics"."id"` — both
    // sides fully qualified. A bare `sql\`... ${topics.id} ...\`` template
    // renders `topics.id` as an unqualified `"id"`, which PostgreSQL then
    // resolves against the inner FROM (messages.id) and the WHERE silently
    // matches nothing.
    const firstUserMessageSubquery = this.db
      .select({ value: messages.content })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), eq(messages.role, 'user')))
      .orderBy(asc(messages.createdAt))
      .limit(1);
    const messageCountSubquery = this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.topicId, topics.id));
    const latestMessageAtSubquery = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), this.messageOwnership()))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
        topics.updatedAt,
      );
    const orderBy = buildTopicOrderBy(topicActivityAt, sortBy);

    const detailColumns = withDetails
      ? {
          description: topics.description,
          firstUserMessage: sql<string | null>`(${firstUserMessageSubquery})`.as(
            'first_user_message',
          ),
          messageCount: sql<number>`(${messageCountSubquery})`.as('message_count'),
          trigger: topics.trigger,
        }
      : {};

    const includeTriggerCondition =
      includeTriggers && includeTriggers.length > 0
        ? inArray(topics.trigger, includeTriggers)
        : undefined;
    const excludeTriggerCondition = includeTriggerCondition
      ? undefined
      : excludeTriggers && excludeTriggers.length > 0
        ? or(isNull(topics.trigger), not(inArray(topics.trigger, excludeTriggers)))
        : undefined;
    const triggerCondition =
      triggers && triggers.length > 0 ? inArray(topics.trigger, triggers) : undefined;
    const excludeStatusCondition =
      excludeStatuses && excludeStatuses.length > 0
        ? or(
            isNull(topics.status),
            not(inArray(topics.status, excludeStatuses as ChatTopicStatus[])),
          )
        : undefined;
    // Topics created before the marker existed carry neither key and therefore
    // match no target — they cannot: what they configured was never recorded
    // anywhere in the row. `topics_agent_id_idx` still drives the scan, so the
    // unindexed JSONB comparison only runs over one agent's rows.
    const editingTargetCondition = and(
      editingAgentId ? sql`${topics.metadata}->>'editingAgentId' = ${editingAgentId}` : undefined,
      editingGroupId ? sql`${topics.metadata}->>'editingGroupId' = ${editingGroupId}` : undefined,
    );

    // If groupId is provided, query topics by groupId directly
    if (groupId) {
      const whereCondition = and(
        this.ownership(),
        this.notShareVisitor(),
        eq(topics.groupId, groupId),
        includeTriggerCondition,
        excludeTriggerCondition,
        triggerCondition,
        excludeStatusCondition,
      );

      const [items, totalResult] = await Promise.all([
        runTimedStage(
          timing,
          'db.topic.query.group.items.select',
          () =>
            this.db
              // Cast to `any` because Drizzle's `.select` infers a strict
              // SelectedFields shape and the conditional `detailColumns` widens
              // to a union; the runtime shape is correct and the client casts
              // back to `ChatTopic[]` after TRPC serialization.
              .select({
                completedAt: topics.completedAt,
                createdAt: topics.createdAt,
                favorite: topics.favorite,
                historySummary: topics.historySummary,
                id: topics.id,
                metadata: topics.metadata,
                model: topics.model,
                provider: topics.provider,
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
                // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
                // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
                // fallback to the row's own updatedAt). Keeping it separate from the
                // display `updatedAt` above matches the client-side sort key to the server
                // order (otherwise the two disagree and the list visibly jumps) while a
                // rename/favorite edit still shows its real edit time. See rankTopics for
                // the same activity-time pattern.
                sortUpdatedAt: topicActivityAt,
                // Workspace sidebars filter maintenance actions client-side by
                // ownership (own vs workspace scope) — the filter needs the row
                // owner even in the slim projection.
                userId: topics.userId,
                ...detailColumns,
              } as any)
              .from(topics)
              .where(whereCondition)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset(offset),
          { current, pageSize },
        ),
        runTimedStage(timing, 'db.topic.query.group.count.select', () =>
          this.db
            .select({ count: count(topics.id) })
            .from(topics)
            .where(whereCondition),
        ),
      ]);

      logTiming(timing, 'db.topic.query:done', {
        itemCount: items.length,
        stageMs: getDurationMs(queryStartedAt),
        total: totalResult[0].count,
      });
      return { items, total: totalResult[0].count };
    }

    // If agentId is provided, match topics by `topics.agentId` directly. The
    // inbox agent additionally adopts very old orphan rows where every owner
    // column (session / group / agent) is null.
    if (agentId) {
      const agentCondition = isInbox
        ? or(
            eq(topics.agentId, agentId),
            and(isNull(topics.sessionId), isNull(topics.groupId), isNull(topics.agentId)),
          )
        : eq(topics.agentId, agentId);

      const agentWhere = and(
        this.ownership(),
        this.notShareVisitor(),
        agentCondition,
        editingTargetCondition,
        includeTriggerCondition,
        excludeTriggerCondition,
        triggerCondition,
        excludeStatusCondition,
      );

      const [items, totalResult] = await Promise.all([
        runTimedStage(
          timing,
          'db.topic.query.agent.items.select',
          () =>
            this.db
              // See note on the group-branch select above re: `as any` cast.
              .select({
                completedAt: topics.completedAt,
                createdAt: topics.createdAt,
                favorite: topics.favorite,
                historySummary: topics.historySummary,
                id: topics.id,
                metadata: topics.metadata,
                model: topics.model,
                provider: topics.provider,
                status: topics.status,
                title: topics.title,
                updatedAt: topics.updatedAt,
                // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
                // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
                // fallback to the row's own updatedAt). Keeping it separate from the
                // display `updatedAt` above matches the client-side sort key to the server
                // order (otherwise the two disagree and the list visibly jumps) while a
                // rename/favorite edit still shows its real edit time. See rankTopics for
                // the same activity-time pattern.
                sortUpdatedAt: topicActivityAt,
                // Workspace sidebars filter maintenance actions client-side by
                // ownership (own vs workspace scope) — the filter needs the row
                // owner even in the slim projection.
                userId: topics.userId,
                ...detailColumns,
              } as any)
              .from(topics)
              .where(agentWhere)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset(offset),
          { current, isInbox: !!isInbox, pageSize },
        ),
        runTimedStage(
          timing,
          'db.topic.query.agent.count.select',
          () =>
            this.db
              .select({ count: count(topics.id) })
              .from(topics)
              .where(agentWhere),
          { isInbox: !!isInbox },
        ),
      ]);

      logTiming(timing, 'db.topic.query:done', {
        itemCount: items.length,
        stageMs: getDurationMs(queryStartedAt),
        total: totalResult[0].count,
      });
      return { items, total: totalResult[0].count };
    }

    // Fallback to containerId-based query (backward compatibility)
    const whereCondition = and(
      this.ownership(),
      this.notShareVisitor(),
      this.matchContainer(containerId),
      includeTriggerCondition,
      excludeTriggerCondition,
      triggerCondition,
      excludeStatusCondition,
    );

    const [items, totalResult] = await Promise.all([
      runTimedStage(
        timing,
        'db.topic.query.container.items.select',
        () =>
          this.db
            // See note on the group-branch select above re: `as any` cast.
            .select({
              agentId: topics.agentId,
              completedAt: topics.completedAt,
              createdAt: topics.createdAt,
              favorite: topics.favorite,
              historySummary: topics.historySummary,
              id: topics.id,
              metadata: topics.metadata,
              model: topics.model,
              provider: topics.provider,
              sessionId: topics.sessionId,
              status: topics.status,
              title: topics.title,
              updatedAt: topics.updatedAt,
              // Sidebar sorts/groups topics client-side by this `sortUpdatedAt` — the
              // same `topicActivityAt` the ORDER BY uses (latest message time, COALESCE
              // fallback to the row's own updatedAt). Keeping it separate from the
              // display `updatedAt` above matches the client-side sort key to the server
              // order (otherwise the two disagree and the list visibly jumps) while a
              // rename/favorite edit still shows its real edit time. See rankTopics for
              // the same activity-time pattern.
              sortUpdatedAt: topicActivityAt,
              // Workspace sidebars filter maintenance actions client-side by
              // ownership (own vs workspace scope) — the filter needs the row
              // owner even in the slim projection.
              userId: topics.userId,
              ...detailColumns,
            } as any)
            .from(topics)
            .where(whereCondition)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset),
        { current, pageSize },
      ),
      runTimedStage(timing, 'db.topic.query.container.count.select', () =>
        this.db
          .select({ count: count(topics.id) })
          .from(topics)
          .where(whereCondition),
      ),
    ]);

    // Remove internal fields before returning

    const cleanItems = items.map(({ agentId: _agentId, sessionId: _sessionId, ...rest }) => rest);

    logTiming(timing, 'db.topic.query:done', {
      itemCount: cleanItems.length,
      stageMs: getDurationMs(queryStartedAt),
      total: totalResult[0].count,
    });

    return { items: cleanItems, total: totalResult[0].count };
  };

  /**
   * Ownership-scoped lookup. Agent-share visitor topics carry the CREATOR's
   * `userId` and are excluded by default; the share runtime opts in by
   * constructing the model with `{ includeShareVisitor: true }`.
   * `findVisitorTopicOrThrow` in `apps/server/src/routers/lambda/shareChat.ts`
   * relies on that opt-in and then verifies `senderId` itself.
   */
  findById = async (id: string) => {
    return this.db.query.topics.findFirst({
      where: and(eq(topics.id, id), this.ownership()),
    });
  };

  /**
   * Kept for readability at creator-facing router call sites; the default
   * scope already excludes agent-share visitor topics, so this is a thin
   * alias of {@link TopicModel.findById}.
   */
  findOwnTopicById = async (id: string) => {
    return this.findById(id);
  };

  /**
   * Ids among `ids` that resolve to an agent-share VISITOR topic under this
   * owner — the inverse of {@link notShareVisitorTopic}, the predicate every
   * creator-facing read applies.
   *
   * Creator-facing write entry points use this to reject visitor targets
   * (see `assertCreatorTopicTargets` in the server router helpers). Ids that
   * match no row at all are NOT reported, so callers keep their existing no-op
   * behaviour for stale/foreign ids.
   */
  findShareVisitorTopicIds = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({ id: topics.id })
      .from(topics)
      // Explicitly scoped visitor-inclusive: this method's whole job is to
      // return visitor ids so the router-level `assertCreatorTopicTargets`
      // can reject them, so it must bypass the instance's visitor exclusion.
      .where(and(inArray(topics.id, ids), this.workspaceScope(), isNotNull(topics.senderId)));

    return rows.map((row) => row.id);
  };

  findByIds = async (ids: string[]): Promise<TopicItem[]> => {
    if (ids.length === 0) return [];
    return this.db.query.topics.findMany({
      where: and(inArray(topics.id, ids), this.ownership()),
    });
  };

  /**
   * Kept for readability at creator-facing router call sites; the default
   * scope already excludes agent-share visitor topics, so this is a thin
   * alias of {@link TopicModel.findByIds}.
   */
  findOwnTopicsByIds = async (ids: string[]): Promise<TopicItem[]> => {
    return this.findByIds(ids);
  };

  /**
   * Minimal creator projection for router-level workspace row checks on
   * batch-by-ids operations (batch delete / move).
   */
  findOwnersByIds = async (ids: string[]): Promise<{ id: string; userId: string }[]> => {
    if (ids.length === 0) return [];

    return this.db
      .select({ id: topics.id, userId: topics.userId })
      .from(topics)
      .where(and(inArray(topics.id, ids), this.ownership()));
  };

  /**
   * Find the unique topic an agent shares with a document for a given trigger
   * (e.g. the doc-anchored chat topic provisioned by
   * `agentDocument.getOrCreateChatTopic`). Joins through `topic_documents`.
   */
  findByAgentAndDocumentTrigger = async (params: {
    agentId: string;
    documentId: string;
    trigger: string;
  }): Promise<TopicItem | undefined> => {
    const result = await this.db
      .select({ topic: topics })
      .from(topics)
      .innerJoin(topicDocuments, eq(topicDocuments.topicId, topics.id))
      .where(
        and(
          this.ownership(),
          eq(topics.agentId, params.agentId),
          eq(topics.trigger, params.trigger),
          eq(topicDocuments.documentId, params.documentId),
        ),
      )
      .limit(1);

    return result[0]?.topic;
  };

  /**
   * Query the current user's topics, optionally filtered by status — e.g. to
   * list actively-running topics across all agents without pulling the full
   * topic set to the client.
   *
   * `withLastMessage` additionally pulls each topic's last assistant reply, so a
   * list can show what the agent actually said instead of just a title. The
   * preview is truncated server-side — raw assistant output is unbounded
   * markdown, and a list only ever renders the head of it.
   */
  queryTopics = async ({
    statuses,
    pageSize = 200,
    withLastMessage,
  }: {
    pageSize?: number;
    statuses?: string[];
    withLastMessage?: boolean;
  } = {}): Promise<TopicListItem[]> => {
    const where = and(
      this.ownership(),
      this.notShareVisitor(),
      statuses && statuses.length > 0
        ? inArray(topics.status, statuses as ChatTopicStatus[])
        : undefined,
    );

    // When the topic's current run started, so a list can show live elapsed
    // time instead of `updatedAt` (which moves on every message write). The
    // latest *top-level* running operation is the current run: sub-operations
    // (callAgent) would restart the clock at their own spawn time, and an
    // abandoned `running` row from a crashed earlier run sorts below the live
    // one. Not scoped by `ownership()` — in a workspace the run may have been
    // started by another member, and the topic join is already ownership-gated.
    const runStartedAtSubquery = this.db
      .select({ value: agentOperations.startedAt })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topics.id),
          eq(agentOperations.status, 'running'),
          isNull(agentOperations.parentOperationId),
          isNotNull(agentOperations.startedAt),
        ),
      )
      .orderBy(desc(agentOperations.startedAt))
      .limit(1);

    // CASE-gated so only rows that are actually running pay for the lookup —
    // and a stale running op under a finished topic can't resurrect a timer.
    const runStartedAtColumn =
      sql<Date | null>`CASE WHEN ${topics.status} = 'running' THEN (${runStartedAtSubquery}) ELSE NULL END`
        .mapWith(agentOperations.startedAt)
        .as('run_started_at');

    if (!withLastMessage) {
      return this.db
        .select({
          ...getTableColumns(topics),
          runStartedAt: runStartedAtColumn,
        })
        .from(topics)
        .where(where)
        .orderBy(desc(topics.updatedAt))
        .limit(pageSize);
    }

    // Built with the query builder rather than a raw `sql` template so the inner
    // `eq(messages.topicId, topics.id)` renders both sides fully qualified —
    // see the note on `firstUserMessageSubquery` in `query()`.
    //
    // Assistant turns that only carried tool calls persist an empty `content`;
    // skipping them lands on the last thing the agent actually *said*.
    // One char past the limit, so the caller can tell "exactly this long" from
    // "cut short" and mark the cut instead of ending mid-sentence.
    const lastAssistantMessageSubquery = this.db
      .select({
        value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topics.id),
          eq(messages.role, 'assistant'),
          this.messageOwnership(),
          ne(messages.content, ''),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const rows = await this.db
      .select({
        ...getTableColumns(topics),
        lastAssistantMessage: sql<string | null>`(${lastAssistantMessageSubquery})`.as(
          'last_assistant_message',
        ),
        runStartedAt: runStartedAtColumn,
      })
      .from(topics)
      .where(where)
      .orderBy(desc(topics.updatedAt))
      .limit(pageSize);

    return rows.map((row) => ({
      ...row,
      lastAssistantMessage:
        row.lastAssistantMessage && row.lastAssistantMessage.length > LAST_MESSAGE_PREVIEW_LENGTH
          ? `${row.lastAssistantMessage.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
          : row.lastAssistantMessage,
    }));
  };

  /**
   * Recent topics from the same IM channel, most-recent first. Matches the
   * channel via the `metadata.bot.platformThreadId` path written at topic
   * creation (see `ChatTopicBotContext`). Used to pre-inject cross-session
   * history on platforms that can't read chat history at runtime (e.g. WeChat,
   * whose `readMessages` throws), so a fresh topic still knows what the channel
   * was just talking about.
   */
  findRecentByBotThread = async (
    platformThreadId: string,
    { limit = 3 }: { limit?: number } = {},
  ): Promise<TopicItem[]> => {
    if (!platformThreadId) return [];

    return this.db
      .select()
      .from(topics)
      .where(
        and(
          this.ownership(),
          sql`${topics.metadata} -> 'bot' ->> 'platformThreadId' = ${platformThreadId}`,
        ),
      )
      .orderBy(desc(topics.updatedAt))
      .limit(limit);
  };

  queryByKeyword = async (
    keyword: string,
    scope?: string | null | TopicKeywordScope,
  ): Promise<TopicItem[]> => {
    if (!keyword.trim()) return [];

    // Backward compatibility: a bare string / null second argument is treated
    // as the legacy `containerId` (sessionId or groupId).
    const scopeOptions: TopicKeywordScope =
      scope && typeof scope === 'object' ? scope : { containerId: scope ?? null };
    const scopeCondition = this.matchKeywordScope(scopeOptions);

    const bm25Query = sanitizeBm25Query(keyword);
    const candidateResults = this.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
      ? await Promise.all([
          this.ftsSearchCandidateSource.ftsSearchCandidates({
            entity: 'topics',
            filters: { topicScope: scopeOptions },
            pagination: {},
            query: { fields: ['title'], text: keyword },
          }),
          this.ftsSearchCandidateSource.ftsSearchCandidates({
            entity: 'messages',
            filters: { topicScope: scopeOptions },
            pagination: {},
            query: { fields: ['content'], text: keyword },
          }),
        ])
      : undefined;
    const topicCandidateIds = candidateResults?.[0].candidates.map(({ id }) => id);
    const messageCandidateIds = candidateResults?.[1].candidates.map(({ id }) => id);

    // Run title and message content searches in parallel
    const [topicsByTitle, topicIdsByMessages] = await Promise.all([
      // Query topics matching by title (BM25)
      this.db
        .select()
        .from(topics)
        .where(
          and(
            this.ownership(),
            this.notShareVisitor(),
            scopeCondition,
            topicCandidateIds
              ? inJsonStringArray(topics.id, topicCandidateIds)
              : sql`${topics.title} @@@ ${bm25Query}`,
          ),
        )
        .orderBy(desc(topics.updatedAt)),
      // Query topic IDs matching by message content (BM25)
      this.db
        .select({ topicId: messages.topicId })
        .from(messages)
        .innerJoin(topics, eq(messages.topicId, topics.id))
        .where(
          and(
            this.messageOwnership(),
            messageCandidateIds
              ? inJsonStringArray(messages.id, messageCandidateIds)
              : sql`${messages.content} @@@ ${bm25Query}`,
            this.ownership(),
            this.notShareVisitor(),
            scopeCondition,
          ),
        )
        .groupBy(messages.topicId),
    ]);
    // If no topics found by message content, return topics matching by title
    if (topicIdsByMessages.length === 0) {
      return topicsByTitle;
    }

    // Query topics found by message content
    const topicIds = topicIdsByMessages
      .map((t) => t.topicId)
      .filter((id): id is string => id !== null);

    const topicsByMessages = await this.db.query.topics.findMany({
      orderBy: [desc(topics.updatedAt)],
      where: and(this.ownership(), inArray(topics.id, topicIds)),
    });

    // Merge results and deduplicate
    const allTopics = [...topicsByTitle];
    const existingIds = new Set(topicsByTitle.map((t) => t.id));

    for (const topic of topicsByMessages) {
      if (!existingIds.has(topic.id)) {
        allTopics.push(topic);
      }
    }

    // Sort by update time
    return allTopics.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  };
  count = async (params?: {
    agentId?: string;
    containerId?: string | null;
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    // Build agent-specific condition if agentId is provided
    const agentCondition: SQL | undefined = params?.agentId
      ? eq(topics.agentId, params.agentId)
      : undefined;

    const result = await this.db
      .select({
        count: count(topics.id),
      })
      .from(topics)
      .where(
        genWhere([
          this.ownership(),
          this.notShareVisitor(),
          agentCondition,
          params?.containerId ? this.matchContainer(params.containerId) : undefined,
          params?.range
            ? genRangeWhere(params.range, topics.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, topics.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, topics.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return result[0].count;
  };

  rank = async (limit: number = 10): Promise<TopicRankItem[]> => {
    return this.db
      .select({
        agentId: topics.agentId,
        count: count(messages.id).as('count'),
        id: topics.id,
        title: topics.title,
      })
      .from(topics)
      .where(and(this.ownership(), this.notShareVisitor()))
      .leftJoin(messages, eq(topics.id, messages.topicId))
      .groupBy(topics.id)
      .orderBy(desc(sql`count`))
      .having(({ count }) => gt(count, 0))
      .limit(limit);
  };

  /**
   * Query recent topics for homepage display.
   * Returns basic topic info with agentId/groupId for later resolution.
   * - For agent topics: excludes virtual agents (except inbox)
   * - For group topics: includes topics with groupId
   * - For inbox: includes topics with slug='inbox'
   */
  queryRecent = async (limit: number = 12) => {
    const latestMessageAtSubquery = this.db
      .select({ value: messages.updatedAt })
      .from(messages)
      .where(and(eq(messages.topicId, topics.id), this.messageOwnership()))
      .orderBy(desc(messages.updatedAt))
      .limit(1);
    const topicActivityAt =
      sql<Date>`COALESCE((${latestMessageAtSubquery}), ${topics.updatedAt})`.mapWith(
        topics.updatedAt,
      );

    const result = await this.db
      .select({
        agentId: topics.agentId,
        groupId: topics.groupId,
        id: topics.id,
        sessionId: topics.sessionId,
        title: topics.title,
        updatedAt: topicActivityAt,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .where(
        and(
          this.ownership(),
          this.notShareVisitor(),
          or(
            // Group topics: has groupId
            not(isNull(topics.groupId)),
            // Inbox agent topics
            eq(agents.slug, 'inbox'),
            // Agent topics: exclude virtual agents
            and(isNull(topics.groupId), ne(agents.virtual, true)),
          ),
        ),
      )
      .orderBy(desc(topicActivityAt))
      .limit(limit);

    return result.map((item) => ({
      ...item,
      type: item.groupId ? ('group' as const) : ('agent' as const),
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt : new Date(item.updatedAt),
    }));
  };

  // **************** Agent Share (visitor-scoped) *************** //

  /**
   * Share-visitor topic list for one visitor on one shared agent. The model is
   * constructed with the CREATOR's userId (visitor topics carry it), so the
   * caller — the shareChat router — must have already authorized the visitor
   * via the share access check; `agentId` + `senderId` together are the
   * per-visitor boundary.
   *
   * `agent_shares` is 1:1 per agent (`agent_shares_agent_id_unique`), so
   * `agentId` alone identifies which share a visitor topic belongs to — there
   * is no `topics.share_id` column to scope by. Turning sharing off and back
   * on keeps the same row and the same `agentId`, so a returning visitor's
   * older conversations DO resurface under the republished share. That is the
   * accepted trade-off of not carrying a share id on the row.
   *
   * Selects a visitor-facing DTO instead of the full row: the visitor surface
   * only renders id/title/runningOperation, and the row also carries
   * creator-only fields (owning userId, model/provider snapshot, cost/usage,
   * internal status and the rest of `metadata`) that must never reach a share
   * visitor. `metadata` itself IS selected (needed to project
   * `runningOperation`), but only the sanitized projection — never the raw
   * column — leaves this method; see {@link VisitorRunningOperation}.
   */
  queryBySender = async (
    { agentId, senderId }: { agentId: string; senderId: string },
    { pageSize = VISITOR_TOPIC_PAGE_SIZE }: { pageSize?: number } = {},
  ): Promise<VisitorTopicItem[]> => {
    const rows = await this.db
      .select({
        createdAt: topics.createdAt,
        id: topics.id,
        metadata: topics.metadata,
        title: topics.title,
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .where(and(this.mine(), eq(topics.agentId, agentId), eq(topics.senderId, senderId)))
      .orderBy(desc(topics.updatedAt))
      .limit(pageSize);

    return rows.map(({ metadata, ...rest }) => ({
      ...rest,
      runningOperation: pickVisitorRunningOperation(metadata),
    }));
  };

  /**
   * Per-visitor topic count on a shared agent — drives `maxTopicsPerVisitor`.
   * Same `(agentId, senderId)` scoping as {@link queryBySender}; see that
   * method's JSDoc for why there is no share-id dimension.
   */
  countBySender = async ({
    agentId,
    senderId,
  }: {
    agentId: string;
    senderId: string;
  }): Promise<number> => {
    const result = await this.db
      .select({ count: count(topics.id) })
      .from(topics)
      .where(and(this.mine(), eq(topics.agentId, agentId), eq(topics.senderId, senderId)));

    return result[0].count;
  };

  /**
   * Creator-facing roll-up for one shared agent: how many conversations
   * visitors started, and how many distinct visitors started them.
   *
   * Counterpart to {@link countBySender}, which counts ONE visitor. Both rely
   * on `senderId` being non-null only for share-originated topics, so the
   * creator's own conversations with the same agent are excluded. Scoped by
   * `this.mine()` like every other read here, so the numbers can only ever
   * describe rows the caller owns.
   *
   * `agentShares` is 1:1 per agent, so `agentId` alone is the share dimension
   * — see {@link queryBySender} for why a disable → re-enable cycle keeps
   * counting the earlier conversations.
   */
  countShareVisitors = async ({
    agentId,
  }: {
    agentId: string;
  }): Promise<{ topicCount: number; visitorCount: number }> => {
    const [result] = await this.db
      .select({
        topicCount: count(topics.id),
        visitorCount: countDistinct(topics.senderId),
      })
      .from(topics)
      .where(and(this.mine(), eq(topics.agentId, agentId), isNotNull(topics.senderId)));

    return {
      topicCount: Number(result?.topicCount ?? 0),
      visitorCount: Number(result?.visitorCount ?? 0),
    };
  };

  // **************** Create *************** //

  create = async (
    { messages: messageIds, ...params }: CreateTopicParams,
    id: string = this.genId(),
    timing?: ModelTimingContext,
  ): Promise<TopicItem> => {
    const insertData = buildWorkspacePayload(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        ...params,
        agentId: params.agentId || null,
        groupId: params.groupId || null,
        id,
        sessionId: params.sessionId || null,
      },
    );
    const insertMeta = {
      hasAgentId: !!params.agentId,
      hasGroupId: !!params.groupId,
      hasSessionId: !!params.sessionId,
    };

    if (!messageIds || messageIds.length === 0) {
      const [topic] = await runTimedStage(
        timing,
        'db.topic.create.topics.insert',
        () => this.db.insert(topics).values(insertData).returning(),
        insertMeta,
      );

      return topic;
    }

    return runTimedStage(
      timing,
      'db.topic.create.transaction',
      () =>
        this.db.transaction(async (tx) => {
          // Insert new topic
          const [topic] = await runTimedStage(
            timing,
            'db.topic.create.topics.insert',
            () => tx.insert(topics).values(insertData).returning(),
            insertMeta,
          );

          // Update associated messages' topicId
          await runTimedStage(
            timing,
            'db.topic.create.messages.updateTopic',
            () =>
              tx
                .update(messages)
                .set({ topicId: topic.id })
                .where(and(this.messageOwnership(), inArray(messages.id, messageIds))),
            { messageCount: messageIds.length },
          );

          return topic;
        }),
      {
        hasAgentId: !!params.agentId,
        hasGroupId: !!params.groupId,
        hasSessionId: !!params.sessionId,
        messageCount: messageIds?.length ?? 0,
      },
    );
  };

  batchCreate = async (topicParams: (CreateTopicParams & { id?: string })[]) => {
    // Start a transaction
    return this.db.transaction(async (tx) => {
      // Batch insert new topics into the topics table
      const createdTopics = await tx
        .insert(topics)
        .values(
          topicParams.map((params) =>
            buildWorkspacePayload(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                agentId: params.agentId || null,
                favorite: params.favorite,
                groupId: params.sessionId ? null : params.groupId,
                id: params.id || this.genId(),
                sessionId: params.groupId ? null : params.sessionId,
                title: params.title,
                trigger: params.trigger,
              },
            ),
          ),
        )
        .returning();

      // For each newly created topic, update the topicId of associated messages
      await Promise.all(
        createdTopics.map(async (topic, index) => {
          const messageIds = topicParams[index].messages;
          if (messageIds && messageIds.length > 0) {
            await tx
              .update(messages)
              .set({ topicId: topic.id })
              .where(and(this.messageOwnership(), inArray(messages.id, messageIds)));
          }
        }),
      );

      return createdTopics;
    });
  };

  duplicate = async (topicId: string, newTitle?: string) => {
    return this.db.transaction(async (tx) => {
      // find original topic
      const originalTopic = await tx.query.topics.findFirst({
        where: and(eq(topics.id, topicId), this.ownership()),
      });

      if (!originalTopic) {
        throw new Error(`Topic with id ${topicId} not found`);
      }

      // copy topic
      const [duplicatedTopic] = await tx
        .insert(topics)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              ...originalTopic,
              ...COPIED_TOPIC_USAGE_RESET,
              clientId: null,
              id: this.genId(),
              title: newTitle || originalTopic?.title,
            },
          ),
        )
        .returning();

      // Find messages associated with the original topic, ordered by createdAt
      const originalMessages = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.topicId, topicId), this.messageOwnership()))
        .orderBy(messages.createdAt);

      // Find all messagePlugins for this topic
      const messageIds = originalMessages.map((m) => m.id);
      const originalPlugins =
        messageIds.length > 0
          ? await tx.select().from(messagePlugins).where(inArray(messagePlugins.id, messageIds))
          : [];

      // Build oldId -> newId mapping for messages
      const idMap = new Map<string, string>();
      originalMessages.forEach((message) => {
        idMap.set(message.id, idGenerator('messages'));
      });

      // Build oldToolId -> newToolId mapping for tools
      const toolIdMap = new Map<string, string>();
      originalMessages.forEach((message) => {
        if (message.tools && Array.isArray(message.tools)) {
          (message.tools as any[]).forEach((tool: any) => {
            if (tool.id) {
              toolIdMap.set(tool.id, `toolu_${idGenerator('messages')}`);
            }
          });
        }
      });

      // copy messages sequentially to respect foreign key constraints
      const duplicatedMessages: DBMessageItem[] = [];
      for (const message of originalMessages) {
        const newId = idMap.get(message.id)!;
        const newParentId = message.parentId ? idMap.get(message.parentId) || null : null;

        // Update tool IDs in tools array
        let newTools = message.tools;
        if (newTools && Array.isArray(newTools)) {
          newTools = (newTools as any[]).map((tool: any) => ({
            ...tool,
            id: tool.id ? toolIdMap.get(tool.id) || tool.id : tool.id,
          }));
        }

        const result = (await tx
          .insert(messages)
          .values({
            ...message,
            clientId: null,
            id: newId,
            // A duplicate consumed no tokens: mark it so usage reports do not
            // count the source's generation twice (the figures themselves stay
            // — they are what the transcript records).
            metadata: markCopiedMessageMetadata(message.metadata),
            parentId: newParentId,
            tools: newTools,
            topicId: duplicatedTopic.id,
          })
          .returning()) as DBMessageItem[];

        duplicatedMessages.push(result[0]);

        // Copy messagePlugins if exists for this message
        const plugin = originalPlugins.find((p) => p.id === message.id);
        if (plugin) {
          const newToolCallId = plugin.toolCallId ? toolIdMap.get(plugin.toolCallId) || null : null;

          await tx.insert(messagePlugins).values({
            ...plugin,
            apiName: clampToolIdentifier(plugin.apiName),
            clientId: null,
            id: newId,
            identifier: clampToolIdentifier(plugin.identifier),
            toolCallId: newToolCallId,
          });
        }
      }

      return {
        messages: duplicatedMessages,
        topic: duplicatedTopic,
      };
    });
  };

  // **************** Delete *************** //

  /**
   * Delete one topic, cascading to the messages associated with it.
   *
   * Agent-share visitor topics carry the creator's `userId`, so ownership alone
   * would let the creator-facing `topic.removeTopic` destroy a visitor
   * conversation from a raw topic id (obtainable out of band, e.g. through data
   * export). Excluded here for the same reason the bulk sweeps exclude them —
   * see {@link deleteAll}.
   */
  delete = async (id: string) => {
    return this.db
      .delete(topics)
      .where(and(eq(topics.id, id), this.ownership(), this.notShareVisitor()));
  };

  /**
   * Deletes multiple topics based on the sessionId.
   * `restrictToCreator` limits the sweep to the caller's own rows (workspace
   * non-owner members must not clear teammates' topics).
   *
   * Visitor topics have no sessionId, so the null-session (inbox) branch would
   * otherwise sweep them in — see {@link deleteAll} for why bulk sweeps exclude
   * them.
   */
  batchDeleteBySessionId = async (
    sessionId?: string | null,
    options?: { restrictToCreator?: boolean },
  ) => {
    return this.db
      .delete(topics)
      .where(
        and(
          this.matchSession(sessionId),
          options?.restrictToCreator ? this.mine() : this.ownership(),
          this.notShareVisitor(),
        ),
      );
  };

  /**
   * Deletes multiple topics based on the groupId.
   * `restrictToCreator` limits the sweep to the caller's own rows in workspace mode.
   *
   * Visitor topics have no groupId, so the null-group branch would otherwise
   * sweep them in — see {@link deleteAll}.
   */
  batchDeleteByGroupId = async (
    groupId?: string | null,
    options?: { restrictToCreator?: boolean },
  ) => {
    return this.db
      .delete(topics)
      .where(
        and(
          this.matchGroup(groupId),
          options?.restrictToCreator ? this.mine() : this.ownership(),
          this.notShareVisitor(),
        ),
      );
  };

  /**
   * Deletes all topics matching the given agentId (`topics.agentId`).
   * `restrictToCreator` limits the sweep to the caller's own rows (workspace
   * non-owner members must not clear teammates' topics).
   *
   * This is the creator's "clear this agent's topics" action, so agent-share
   * visitor topics are excluded (see {@link deleteAll}). Deleting the agent
   * itself is a different path: `topics.agent_id` cascades at the DB level, so
   * visitor topics do go away with the agent without any call to this method.
   */
  batchDeleteByAgentId = async (agentId: string, options?: { restrictToCreator?: boolean }) => {
    return this.db
      .delete(topics)
      .where(
        and(
          options?.restrictToCreator ? this.mine() : this.ownership(),
          eq(topics.agentId, agentId),
          this.notShareVisitor(),
        ),
      );
  };

  /**
   * Deletes multiple topics and all messages associated with them in a transaction.
   *
   * Agent-share visitor topics are excluded — see {@link TopicModel.delete}.
   */
  batchDelete = async (ids: string[]) => {
    return this.db
      .delete(topics)
      .where(and(inArray(topics.id, ids), this.ownership(), this.notShareVisitor()));
  };

  /**
   * Creator-facing "clear all my topics".
   *
   * Agent-share visitor topics live under the creator's `userId` but are hidden
   * from every creator-facing listing (see `notShareVisitorTopic` in
   * `../utils/shareVisitor`), so a sweep the creator cannot see the contents of
   * must not destroy them — "clear all" can only mean the rows the creator sees.
   * The same rule applies to the other id-less sweeps here.
   *
   * Id-targeted deletes ({@link TopicModel.delete}, {@link TopicModel.batchDelete})
   * apply the same guard: a creator can obtain a visitor topic id out of band
   * (data export), so naming the id is not proof the row is theirs to delete.
   */
  deleteAll = async () => {
    return this.db.delete(topics).where(and(this.mine(), this.notShareVisitor()));
  };

  // **************** Update *************** //

  update = async (id: string, data: Partial<TopicItem>) => {
    return this.db
      .update(topics)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(topics.id, id), this.ownership()))
      .returning();
  };

  /**
   * Settle a topic out of `running` once its run has terminated server-side.
   *
   * Guarded on `status = 'running'` so it is race-tolerant with clients: an
   * attached renderer writes 'active' (focused) or 'unread' (backgrounded) on
   * the terminal stream event, and whichever write lands first wins — this one
   * degrades to a no-op instead of clobbering it. Without a server-side settle,
   * a run with no client attached (cron-dispatched scheduled resume, app closed
   * mid-run) leaves the topic at `running` forever.
   *
   * Returns the settled row, or nothing when the guard didn't match.
   */
  settleRunningStatus = async (id: string, status: TopicItem['status'] = 'unread') => {
    return this.db
      .update(topics)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(topics.id, id), eq(topics.status, 'running'), this.ownership()))
      .returning({ id: topics.id, status: topics.status });
  };

  /**
   * Atomically clear and settle the operation that still owns a topic.
   * A row lock keeps a stale terminal callback from clearing a newer operation
   * between the ownership check and update. Missing markers are intentionally
   * not settled because a client-side run can set `status = 'running'` without
   * an operation marker, so there is no proof that the terminal callback owns it.
   *
   * The result distinguishes a missing marker from a conflicting operation:
   * some legitimate hetero callbacks arrive after another terminal path has
   * already cleared their marker, while a callback that observes a newer
   * operation must stop before dispatching lifecycle hooks for the wrong run.
   */
  settleRunningOperation = async (
    id: string,
    operationId: string,
    status: TopicItem['status'] = 'unread',
  ) => {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      const runningOperation = existing?.metadata?.runningOperation;
      if (!runningOperation) {
        const currentMessage = existing?.metadata?.heteroCurrentMsgId;
        if (
          existing?.metadata?.lastSettledOperationId === operationId &&
          existing.status === 'unread' &&
          status === 'active'
        ) {
          await tx
            .update(topics)
            .set({ status: 'active', updatedAt: new Date() })
            .where(and(eq(topics.id, id), this.ownership()));

          return {
            assistantMessageId:
              currentMessage?.operationId === operationId ? currentMessage.msgId : undefined,
            status: 'corrected' as const,
          };
        }

        return {
          assistantMessageId:
            currentMessage?.operationId === operationId ? currentMessage.msgId : undefined,
          status: 'missing' as const,
        };
      }
      const isRoot = runningOperation.operationId === operationId;
      const operation = isRoot
        ? runningOperation
        : runningOperation.childOperations?.find((child) => child.operationId === operationId);
      if (!operation) {
        return { activeOperationId: runningOperation.operationId, status: 'conflict' as const };
      }

      const metadata = {
        ...existing.metadata,
        ...(isRoot ? { lastSettledOperationId: operationId } : {}),
        runningOperation: isRoot
          ? null
          : {
              ...runningOperation,
              childOperations: runningOperation.childOperations?.filter(
                (child) => child.operationId !== operationId,
              ),
            },
      } as ChatTopicMetadata;

      await tx
        .update(topics)
        .set({
          metadata,
          ...(isRoot && existing.status === 'running' ? { status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, id), this.ownership()));

      const currentMessage = existing.metadata?.heteroCurrentMsgId;
      return {
        assistantMessageId:
          currentMessage?.operationId === operationId
            ? currentMessage.msgId
            : operation.assistantMessageId,
        hooks: operation.hooks,
        orchestrationRole: operation.orchestrationRole,
        status: 'settled' as const,
        threadId: operation.threadId ?? undefined,
      };
    });
  };

  /**
   * Move multiple topics (and all their messages) to another agent.
   *
   * Reassigns ownership purely through the `agentId` foreign key (the new data
   * model). Every child entity of the topic that carries its own `agentId` FK
   * MUST be updated together — `topics`, `messages`, and `threads`. Topic lists
   * query by `topics.agentId` and message queries filter by `messages.agentId`,
   * so updating only the topic would leave the moved conversation showing up
   * empty under the target agent; and `threads.agentId` is itself a
   * cascade-on-delete FK, so a thread left pointing at the source agent would
   * be destroyed if that agent is later deleted.
   *
   * `sessionId` is cleared on `topics` and `messages` so the rows fully detach
   * from the source agent's legacy session and can't leak back through the
   * sessionId-based legacy query fallback (`threads` has no `sessionId`).
   *
   * Topics can only be moved to an agent owned by the same user/workspace. The
   * target agent is verified with the same ownership predicate before applying
   * the move — `topics.agentId` / `messages.agentId` are plain FKs to
   * `agents.id` with cascade-on-delete, so attaching rows to a foreign agent
   * would both leak them across tenants and risk losing them if that agent is
   * later deleted.
   */
  batchMoveToAgent = async (topicIds: string[], targetAgentId: string) => {
    if (topicIds.length === 0) return;

    return this.db.transaction(async (tx) => {
      const [targetAgent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, targetAgentId),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
          ),
        )
        .limit(1);

      if (!targetAgent) {
        throw new Error(`Target agent ${targetAgentId} not found or not accessible`);
      }

      await tx
        .update(topics)
        .set({ agentId: targetAgentId, sessionId: null, updatedAt: new Date() })
        .where(and(inArray(topics.id, topicIds), this.ownership()));

      await tx
        .update(messages)
        .set({ agentId: targetAgentId, sessionId: null })
        .where(and(inArray(messages.topicId, topicIds), this.messageOwnership()));

      await tx
        .update(threads)
        .set({ agentId: targetAgentId })
        .where(
          and(
            inArray(threads.topicId, topicIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
          ),
        );
    });
  };

  /**
   * Recompute this topic's denormalized usage/cost rollup from its assistant
   * messages. The canonical aggregation lives in `recomputeTopicUsage`; the
   * live path (MessageModel) calls it inline within its own transaction, while
   * external callers use this wrapper. Runs in a transaction for consistency.
   */
  recomputeUsage = async (id: string) =>
    this.db.transaction((trx) => recomputeTopicUsage(trx, this.userId, id, this.workspaceId));

  /**
   * Update topic metadata with merge logic
   * This method merges new metadata with existing metadata instead of replacing it
   */
  updateMetadata = async (id: string, metadata: TopicMetadataPatch) => {
    // Merge into the existing metadata under a row lock so concurrent writers
    // can't lose each other's keys. The old read-then-write was a non-atomic
    // read-modify-write: a hetero run seeds `metadata.runningOperation` while
    // heteroIngest concurrently writes `metadata.heteroCurrentMsgId`, and a write
    // built on a stale snapshot (interleaved read, or a read-replica that hadn't
    // caught up) silently dropped `runningOperation` — stranding the finished
    // task at `task_topics.status = 'running'` because heteroFinish then had no
    // hooks to deliver. `SELECT … FOR UPDATE` forces a primary read + serializes
    // writers on the row, killing both the interleave and replica-lag variants
    // while preserving the exact (shallow + nested onboardingSession) merge.
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      // No row (missing or not owned) — nothing to update, mirror the old no-op.
      if (!existing) return [];

      const mergedOnboardingSession =
        existing.metadata?.onboardingSession && metadata.onboardingSession
          ? {
              ...existing.metadata.onboardingSession,
              ...metadata.onboardingSession,
            }
          : metadata.onboardingSession;

      const mergedMetadata = {
        ...existing.metadata,
        ...metadata,
        ...(mergedOnboardingSession && { onboardingSession: mergedOnboardingSession }),
      } as ChatTopicMetadata;

      return tx
        .update(topics)
        .set({ metadata: mergedMetadata })
        .where(and(eq(topics.id, id), this.ownership()))
        .returning();
    });
  };

  appendRunningOperationChild = async (
    id: string,
    parentOperationId: string,
    child: NonNullable<ChatTopicMetadata['runningOperation']>,
  ): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');
      const runningOperation = existing?.metadata?.runningOperation;
      if (!existing || runningOperation?.operationId !== parentOperationId) return false;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            runningOperation: {
              ...runningOperation,
              childOperations: [
                ...(runningOperation.childOperations ?? []).filter(
                  (operation) => operation.operationId !== child.operationId,
                ),
                child,
              ],
            },
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));
      return true;
    });

  removeRunningOperationChild = async (id: string, operationId: string): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');
      const runningOperation = existing?.metadata?.runningOperation;
      if (!existing || !runningOperation?.childOperations) return false;
      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            runningOperation: {
              ...runningOperation,
              childOperations: runningOperation.childOperations.filter(
                (child) => child.operationId !== operationId,
              ),
            },
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));
      return true;
    });

  updateRunningOperationAssistantMessage = async (
    id: string,
    operationId: string,
    assistantMessageId: string,
  ): Promise<boolean> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');
      const runningOperation = existing?.metadata?.runningOperation;
      if (!existing || !runningOperation) return false;

      if (runningOperation.operationId === operationId) {
        await tx
          .update(topics)
          .set({
            metadata: {
              ...existing.metadata,
              heteroCurrentMsgId: { msgId: assistantMessageId, operationId },
              runningOperation: { ...runningOperation, assistantMessageId },
            },
          })
          .where(and(eq(topics.id, id), this.ownership()));
        return true;
      }

      const childOperations = runningOperation.childOperations?.map((child) =>
        child.operationId === operationId ? { ...child, assistantMessageId } : child,
      );
      if (!childOperations?.some((child) => child.operationId === operationId)) return false;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            heteroCurrentMsgId: { msgId: assistantMessageId, operationId },
            runningOperation: { ...runningOperation, childOperations },
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));
      return true;
    });

  takeRunningOperation = async (
    id: string,
    operationId: string,
  ): Promise<
    | {
        isRoot: boolean;
        operation: NonNullable<ChatTopicMetadata['runningOperation']>;
      }
    | undefined
  > =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');
      const runningOperation = existing?.metadata?.runningOperation;
      if (!existing || !runningOperation) return undefined;

      if (runningOperation.operationId === operationId) {
        await tx
          .update(topics)
          .set({
            metadata: { ...existing.metadata, runningOperation: null },
          })
          .where(and(eq(topics.id, id), this.ownership()));
        return { isRoot: true, operation: runningOperation };
      }

      const child = runningOperation.childOperations?.find(
        (candidate) => candidate.operationId === operationId,
      );
      if (!child) return undefined;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            runningOperation: {
              ...runningOperation,
              childOperations: runningOperation.childOperations?.filter(
                (candidate) => candidate.operationId !== operationId,
              ),
            },
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));
      return { isRoot: false, operation: child };
    });

  /**
   * Whether the run a `runningOperation` marker points at is still the topic's
   * legitimate owner.
   *
   * Public so the gateway-token refresh routers can refuse to reconnect a
   * client to a marker whose run has already ended (the marker is cleared
   * best-effort, so a stale one must not be taken at face value).
   *
   * The marker itself cannot answer this — it carries no heartbeat and is
   * cleared best-effort — so the authority is the operation row, which both the
   * in-process runtime (`createOperation`) and the heterogeneous path
   * (`CompletionLifecycle.recordStart`) write before publishing the marker.
   *
   * Falls back to the marker's own `startedAt` only when no row exists: hetero's
   * `recordStart` is deliberately non-fatal, so a DB hiccup can leave a live run
   * with a marker and no row. A marker with neither a row nor a stamp cannot be
   * proven live and must not keep an already-stuck topic stuck.
   */
  isRunningOperationAlive = async (
    tx: Pick<LobeChatDatabase, 'select'>,
    runningOperation: NonNullable<ChatTopicMetadata['runningOperation']>,
  ): Promise<boolean> => {
    const [operation] = await tx
      .select({ createdAt: agentOperations.createdAt, status: agentOperations.status })
      .from(agentOperations)
      .where(eq(agentOperations.id, runningOperation.operationId))
      .limit(1);

    if (!operation) {
      const markerStartedAt = runningOperation.startedAt
        ? Date.parse(runningOperation.startedAt)
        : Number.NaN;
      return (
        Number.isFinite(markerStartedAt) &&
        Date.now() - markerStartedAt < ABANDONED_OPERATION_TTL_MS
      );
    }

    if (!LIVE_OPERATION_STATUSES.has(operation.status)) return false;
    if (UNBOUNDED_OPERATION_STATUSES.has(operation.status)) return true;

    // Claims `running`/`idle`, but a killed process never writes a terminal
    // status — age it out so the topic is not held forever.
    const startedAt = operation.createdAt ? new Date(operation.createdAt).getTime() : Number.NaN;
    return !Number.isFinite(startedAt) || Date.now() - startedAt < ABANDONED_OPERATION_TTL_MS;
  };

  /**
   * Atomically reserve an idle topic for one task-callback delivery.
   *
   * The topic row lock closes the check/set race between callback workers:
   * only one callback can observe both `runningOperation` and the reservation
   * as empty. Foreground/tool continuations clear `runningOperation` before a
   * callback can claim the topic, so the callback always re-anchors on the
   * completed turn's latest spine.
   */
  tryReserveTaskCallback = async (
    id: string,
    messageId: string,
    options?: {
      /**
       * Permit a start that runs *under* this marker (a group member starting
       * beneath its supervisor). A pure permission check — it never takes the
       * reservation.
       */
      allowRunningOperationId?: string;
      /**
       * A deterministic intervention reservation is an initializer fence, not
       * a reentrant mutex. Its concurrent same-id caller must wait until the
       * owner releases (or the lease expires) instead of entering preparation
       * and overwriting an already-running continuation state.
       */
      allowSameReservationReentry?: boolean;
      /**
       * Skip the `runningOperation` check entirely and serialize only on the
       * short reservation. Set by interactive sends: "don't run two foreground
       * turns at once" is a UX policy the client already owns end to end (queue
       * tray, "Send now", FIFO drain), and it is the only layer that can show
       * the user anything. A second, blind copy of that policy here can only
       * fail worse — it used to destroy the message before it was ever
       * persisted. Background starts (task callbacks, cron, bots) have no such
       * queue and keep the check.
       */
      ignoreRunningOperation?: boolean;
      replacesOperationId?: string;
    },
  ): Promise<boolean | null> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      if (!existing) return null;

      const reservation = existing.metadata?.taskCallbackReservation;
      const reservedAt = reservation ? Date.parse(reservation.reservedAt) : 0;
      const hasLiveReservation =
        reservation &&
        Number.isFinite(reservedAt) &&
        Date.now() - reservedAt < TASK_CALLBACK_RESERVATION_TTL_MS;

      if (
        reservation?.messageId === messageId &&
        hasLiveReservation &&
        options?.allowSameReservationReentry !== false
      ) {
        return true;
      }

      const runningOperation = existing.metadata?.runningOperation;
      const ownedRunningOperation =
        !!options?.allowRunningOperationId &&
        runningOperation?.operationId === options.allowRunningOperationId;
      if (options?.allowRunningOperationId) return ownedRunningOperation;

      const canReplaceRunningOperation =
        !!options?.replacesOperationId &&
        runningOperation?.operationId === options.replacesOperationId;

      // Only a run that can prove it is still alive may hold the topic. Ask the
      // operation row rather than the marker's age: the marker is never
      // refreshed, so age alone declares a legitimately long run (an approval
      // wait can last days) dead and lets a competing continuation start.
      const hasLiveRunningOperation =
        !!runningOperation &&
        !canReplaceRunningOperation &&
        !options?.ignoreRunningOperation &&
        (await this.isRunningOperationAlive(tx, runningOperation));

      if (hasLiveRunningOperation || hasLiveReservation) return false;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            ...(canReplaceRunningOperation && { runningOperation: null }),
            taskCallbackReservation: {
              messageId,
              reservedAt: new Date().toISOString(),
            },
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));

      return true;
    });

  /**
   * Repair the reconnect anchor after an intervention queue ACK. The same row
   * lock also releases only this continuation's reservation, closing the crash
   * window between provider ACK and execAgent's ordinary running-marker write.
   */
  repairAgentInterventionContinuation = async (params: {
    active: boolean;
    assistantMessageId: string;
    continuationOperationId: string;
    reservationId: string;
    scope?: string | null;
    sourceOperationId: string;
    startedAt: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<'conflict' | 'repaired' | 'terminal'> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, params.topicId), this.ownership()))
        .for('update');
      if (!existing) return 'conflict';

      const current = existing.metadata?.runningOperation;
      const reservation = existing.metadata?.taskCallbackReservation;
      const reservedAt = reservation ? Date.parse(reservation.reservedAt) : 0;
      const hasLiveReservation =
        !!reservation &&
        Number.isFinite(reservedAt) &&
        Date.now() - reservedAt < TASK_CALLBACK_RESERVATION_TTL_MS;
      const ownsCurrent =
        !current ||
        current.operationId === params.sourceOperationId ||
        current.operationId === params.continuationOperationId;
      const ownsReservation = reservation?.messageId === params.reservationId;
      if (hasLiveReservation && !ownsReservation) return 'conflict';
      if (!ownsCurrent) {
        if (ownsReservation) {
          await tx
            .update(topics)
            .set({
              metadata: { ...existing.metadata, taskCallbackReservation: null },
              updatedAt: new Date(),
            })
            .where(and(eq(topics.id, params.topicId), this.ownership()));
        }
        return 'conflict';
      }

      const runningOperation = params.active
        ? {
            ...(current?.operationId === params.continuationOperationId ? current : {}),
            assistantMessageId: params.assistantMessageId,
            heteroType: null,
            operationId: params.continuationOperationId,
            scope: params.scope ?? undefined,
            startedAt: params.startedAt,
            threadId: params.threadId ?? undefined,
          }
        : null;
      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            runningOperation,
            ...(ownsReservation || !hasLiveReservation ? { taskCallbackReservation: null } : {}),
          },
          updatedAt: new Date(),
        })
        .where(and(eq(topics.id, params.topicId), this.ownership()));

      return params.active ? 'repaired' : 'terminal';
    });

  /**
   * Release only the caller's reservation. The ownership check prevents a
   * delayed finally block from clearing a newer callback's claim.
   */
  releaseTaskCallbackReservation = async (
    id: string,
    messageId: string,
  ): Promise<'absent' | 'foreign' | 'released'> =>
    this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      const reservation = existing?.metadata?.taskCallbackReservation;
      if (!reservation) return 'absent';
      if (reservation.messageId !== messageId) return 'foreign';

      await tx
        .update(topics)
        .set({
          metadata: {
            ...existing.metadata,
            taskCallbackReservation: null,
          },
        })
        .where(and(eq(topics.id, id), this.ownership()));
      return 'released';
    });

  /**
   * Arm a scheduled run on an owned topic: writes `metadata.scheduledRun` and
   * flips the status to `scheduled` in a single update.
   *
   * The pair is one fact — a topic that is `scheduled` with no payload spins in
   * the dispatcher forever, and a payload on a non-`scheduled` topic never fires
   * — so they must never be written separately. The inverse is
   * {@link TopicModel.clearScheduledRun}.
   */
  armScheduledRun = async (id: string, scheduledRun: TopicScheduledRun): Promise<void> => {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, id), this.ownership()))
        .for('update');

      if (!existing) return;

      await tx
        .update(topics)
        .set({
          metadata: { ...existing.metadata, scheduledRun } as ChatTopicMetadata,
          status: 'scheduled',
        })
        .where(and(eq(topics.id, id), this.ownership()));
    });
  };

  getCronTopicsGroupedByCronJob = async (
    agentId: string,
  ): Promise<{ cronJobId: string; topics: TopicItem[] }[]> => {
    const rows = await this.db
      .select()
      .from(topics)
      .where(
        and(
          this.ownership(),
          eq(topics.agentId, agentId),
          eq(topics.trigger, 'cron'),
          sql`COALESCE(${topics.metadata}->>'cronJobId', '') <> ''`,
        ),
      )
      .orderBy(desc(topics.createdAt));

    const grouped = new Map<string, TopicItem[]>();
    for (const topic of rows) {
      const cronJobId = (topic.metadata as { cronJobId?: string } | null)?.cronJobId;
      if (!cronJobId) continue;
      const group = grouped.get(cronJobId) ?? [];
      group.push(topic);
      grouped.set(cronJobId, group);
    }

    return [...grouped.entries()].map(([cronJobId, topicList]) => ({
      cronJobId,
      topics: topicList,
    }));
  };

  // **************** Helper *************** //

  private genId = () => idGenerator('topics');

  private matchSession = (sessionId?: string | null) =>
    sessionId ? eq(topics.sessionId, sessionId) : isNull(topics.sessionId);

  private matchGroup = (groupId?: string | null) =>
    groupId ? eq(topics.groupId, groupId) : isNull(topics.groupId);

  private matchContainer = (containerId?: string | null) => {
    if (containerId) return or(eq(topics.sessionId, containerId), eq(topics.groupId, containerId));
    // If neither is provided, match topics with no session or group
    return and(isNull(topics.sessionId), isNull(topics.groupId));
  };

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
  private matchKeywordScope = ({
    agentId,
    containerId,
    groupId,
  }: TopicKeywordScope): SQL | undefined => {
    if (groupId) return eq(topics.groupId, groupId);
    if (agentId) return eq(topics.agentId, agentId);
    return this.matchContainer(containerId);
  };

  listTopicsForMemoryExtractor = async (
    options: {
      cursor?: ListTopicsForMemoryExtractorCursor;
      endDate?: Date;
      ignoreExtracted?: boolean;
      limit?: number;
      startDate?: Date;
    } = {},
  ) => {
    const cursorCondition = options.cursor
      ? and(
          ne(topics.id, options.cursor.id),
          or(
            gt(topics.createdAt, options.cursor.createdAt),
            and(eq(topics.createdAt, options.cursor.createdAt), gt(topics.id, options.cursor.id)),
          ),
        )
      : undefined;

    return this.db.query.topics.findMany({
      columns: {
        createdAt: true,
        id: true,
        metadata: true,
        userId: true,
      },
      limit: options.limit,
      orderBy: (fields, { asc }) => [asc(fields.createdAt), asc(fields.id)],
      where: and(
        this.ownership(),
        // Share-visitor conversations are not the creator's own speech — never
        // feed them into the creator's memory extraction.
        this.notShareVisitor(),
        options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
        options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
        options.ignoreExtracted
          ? undefined
          : // COALESCE, not `IS DISTINCT FROM`: a null test on a jsonb arrow
            // expression crashes the production engine (see the note on the class).
            // A null `metadata` extracts to '' here too, so this covers it.
            sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
        cursorCondition,
      ),
    });
  };

  countTopicsForMemoryExtractor = async (
    options: {
      endDate?: Date;
      ignoreExtracted?: boolean;
      startDate?: Date;
    } = {},
  ) => {
    const result = await this.db
      .select({ total: count(topics.id) })
      .from(topics)
      .where(
        and(
          this.ownership(),
          this.notShareVisitor(),
          options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
          options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
          options.ignoreExtracted
            ? undefined
            : sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
        ),
      );

    return result[0]?.total ?? 0;
  };

  /**
   * Resets the memory-extraction state of all the caller's topics back to
   * `pending`, clearing any previous run summary. Used by "purge all
   * memories": after memories are deleted, topics keep `userMemoryExtractStatus =
   * 'completed'`, so `isTopicExtracted()` skips them forever and nothing can
   * ever be re-extracted. Resetting to `pending` makes the next memory
   * analysis re-process them. Fixes #18498.
   *
   * Scoped by `userId` only (not `mine()`): `deleteAll` removes every memory
   * belonging to the caller regardless of workspace scope, so the reset must
   * cover topics across personal and all workspace scopes alike, otherwise
   * topics in the other scope keep `completed` and stay stuck behind the
   * extraction skip gate.
   */
  resetMemoryExtractStatus = async () => {
    return this.db
      .update(topics)
      .set({
        metadata: sql`jsonb_set(
          jsonb_set(${topics.metadata}, '{userMemoryExtractStatus}', to_jsonb('pending'::text), true),
          '{userMemoryExtractRunState}', '{}'::jsonb, true
        )`,
      })
      .where(eq(topics.userId, this.userId));
  };

  // **************** Scheduled run (backend cron) *************** //

  /**
   * Topics with a scheduled run that has come due.
   * System-level sweep (no ownership filter) used by the cron dispatcher.
   *
   * Due = `status = 'scheduled'` AND the run's gate has passed AND there is no
   * live claim (`scheduledRun.claim.expiresAt` is absent, or already expired) —
   * so a topic another replica is mid-dispatch on is skipped.
   *
   * `runAt` is the gate for every {@link TopicScheduledRunKind}: a row carrying a
   * `kind` but no `runAt` is never due, which is what keeps a half-written
   * scheduled topic from being dispatched immediately.
   *
   * The one exception is a row parked by the pre-`kind` version, which has no
   * `runAt` and gated on the rate-limit reset instead. Those are still in the DB
   * on deploy, so this reproduces their old gate rather than stranding them at
   * `scheduled` forever — matching `parseTopicScheduledRun`, which upgrades the
   * payload the dispatcher then reads.
   */
  static async getDueScheduledTopics(
    db: LobeChatDatabase,
    now: Date = new Date(),
  ): Promise<TopicItem[]> {
    const nowIso = now.toISOString();
    const nowEpochSeconds = Math.floor(now.getTime() / 1000);

    // Every jsonb path below is COALESCE'd to a sentinel rather than null-tested:
    // `#>> … IS NULL` in a WHERE clause takes the production engine down. See the
    // note on the class.
    const runAt = sql`COALESCE(${topics.metadata}#>>'{scheduledRun,runAt}', '')`;

    return db
      .select()
      .from(topics)
      .where(
        and(
          eq(topics.status, 'scheduled'),
          or(
            // `''` is the absent-runAt sentinel, and it never satisfies this pair —
            // an absent gate must not read as "due now", which is what keeps a
            // half-written schedule parked.
            and(sql`${runAt} <> ''`, sql`${runAt} <= ${nowIso}`),
            // Legacy (pre-`kind`) payload: no `runAt`, gated on the rate-limit
            // reset, and an absent reset read as "due now" (hence the 0 default).
            and(
              sql`${runAt} = ''`,
              sql`COALESCE(${topics.metadata}#>>'{scheduledRun,reason}', '') = 'rate_limit'`,
              sql`COALESCE((${topics.metadata}#>>'{scheduledRun,rateLimit,resetsAt}')::numeric, 0) <= ${nowEpochSeconds}`,
            ),
          ),
          // No claim, or the lease has expired. `''` (no claim) sorts before every
          // ISO timestamp, so the same comparison covers both.
          sql`COALESCE(${topics.metadata}#>>'{scheduledRun,claim,expiresAt}', '') <= ${nowIso}`,
        ),
      );
  }

  /**
   * Atomically claim a scheduled topic before dispatch, so two concurrent cron
   * ticks can't trigger the same continuation twice. Serializes on the row with
   * `SELECT … FOR UPDATE` (mirrors {@link updateMetadata}) and only writes the
   * lease if the topic is still `scheduled` and not already claimed by a live
   * lease. Returns `true` when this caller won the claim.
   */
  static async claimScheduledTopic(
    db: LobeChatDatabase,
    id: string,
    claim: { claimedAt: string; expiresAt: string; id: string },
    now: Date = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');

      if (!row || row.status !== 'scheduled') return false;

      const scheduledRun = row.metadata?.scheduledRun;
      if (!scheduledRun) return false;

      const existingClaim = scheduledRun.claim;
      const claimLive = existingClaim && new Date(existingClaim.expiresAt) > now;
      if (claimLive) return false;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...row.metadata,
            scheduledRun: { ...scheduledRun, claim },
          } as ChatTopicMetadata,
        })
        .where(eq(topics.id, id));

      return true;
    });
  }

  /**
   * Clear the scheduled continuation and restore a normal status. Used both when
   * a continuation is successfully dispatched/executed and when it is cancelled.
   */
  static async clearScheduledRun(
    db: LobeChatDatabase,
    id: string,
    nextStatus: ChatTopicStatus = 'active',
    expectedClaimId?: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');
      if (!row || row.status !== 'scheduled') return;
      if (expectedClaimId && row.metadata?.scheduledRun?.claim?.id !== expectedClaimId) return;

      const nextMetadata = { ...row.metadata, scheduledRun: null } as ChatTopicMetadata;
      await tx
        .update(topics)
        .set({ metadata: nextMetadata, status: nextStatus })
        .where(eq(topics.id, id));
    });
  }

  /**
   * Re-point a still-pending scheduled run at a new failed-attempt message. A
   * dispatch that fails inside execAgent leaves its own error bubble on the
   * placeholder it created; tracking that bubble as the run's
   * `failedAssistantMessageId` lets the next tick's pre-dispatch cleanup clear
   * it the same way it clears the original card, so retries don't strand one
   * stale error bubble per failed attempt.
   *
   * `expectedClaimId` fences stale writers the same way it does in
   * {@link TopicModel.clearScheduledRun}: a dispatch attempt that outlived its
   * claim lease — or one whose schedule the user cancelled and re-armed — must
   * not overwrite the pointer of a NEWER scheduled run, or the next cleanup
   * would delete / anchor against an unrelated message. No-ops when the
   * schedule was cleared or the claim no longer matches.
   */
  static async repointScheduledRunFailedMessage(
    db: LobeChatDatabase,
    id: string,
    failedAssistantMessageId: string,
    expectedClaimId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ metadata: topics.metadata, status: topics.status })
        .from(topics)
        .where(eq(topics.id, id))
        .for('update');
      if (!row || row.status !== 'scheduled') return;

      const scheduledRun = row.metadata?.scheduledRun;
      if (!scheduledRun) return;
      if (scheduledRun.claim?.id !== expectedClaimId) return;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...row.metadata,
            scheduledRun: {
              ...scheduledRun,
              failedAssistantMessageId,
              updatedAt: new Date().toISOString(),
            },
          } as ChatTopicMetadata,
        })
        .where(eq(topics.id, id));
    });
  }
}
