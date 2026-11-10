import type { FtsSearchCandidateSource } from '../../repositories/ftsSearch';
import type { LobeChatDatabase } from '../../type';
import type { TopicModelContext } from './context';
import { createTopicModelContext } from './context';
import * as create from './create';
import * as remove from './delete';
import * as find from './find';
import * as list from './list';
import * as memoryExtractor from './memoryExtractor';
import * as runningOperation from './runningOperation';
import * as scheduledRun from './scheduledRun';
import * as shareVisitor from './shareVisitor';
import * as taskCallback from './taskCallback';
import * as trash from './trash';
import * as update from './update';

export { getTopicDeviceId } from './runningOperation';
export { hasLiveTaskCallbackReservation } from './taskCallback';
export type {
  CreateTopicParams,
  ListTopicsForMemoryExtractorCursor,
  ModelTimingContext,
  SettleRunningOperationOptions,
  TopicKeywordScope,
  TopicListItem,
  VisitorRunningOperation,
  VisitorTopicItem,
} from './types';

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
  private ctx: TopicModelContext;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
    options: TopicModelOptions = {},
  ) {
    this.ctx = createTopicModelContext({
      db,
      ftsSearchCandidateSource,
      includeShareVisitor: options.includeShareVisitor ?? false,
      userId,
      workspaceId,
    });
  }

  /**
   * Binds an operation module function to this instance's context. The context
   * is read at call time, so the bound methods can be class fields even though
   * the context is assigned in the constructor body.
   */
  private withContext<A extends unknown[], R>(fn: (ctx: TopicModelContext, ...args: A) => R) {
    return (...args: A): R => fn(this.ctx, ...args);
  }

  // **************** List *************** //

  query = this.withContext(list.query);
  queryTopics = this.withContext(list.queryTopics);

  // **************** Read *************** //

  findById = this.withContext(find.findById);
  findOwnTopicById = this.withContext(find.findOwnTopicById);
  findShareVisitorTopicIds = this.withContext(find.findShareVisitorTopicIds);
  findByIds = this.withContext(find.findByIds);
  findOwnTopicsByIds = this.withContext(find.findOwnTopicsByIds);
  findOwnersByIds = this.withContext(find.findOwnersByIds);
  findByAgentAndDocumentTrigger = this.withContext(find.findByAgentAndDocumentTrigger);
  findRunInitiators = this.withContext(find.findRunInitiators);
  findRecentByBotThread = this.withContext(find.findRecentByBotThread);
  queryByKeyword = this.withContext(find.queryByKeyword);
  count = this.withContext(find.countTopics);
  rank = this.withContext(find.rank);
  queryRecent = this.withContext(find.queryRecent);
  getCronTopicsGroupedByCronJob = this.withContext(find.getCronTopicsGroupedByCronJob);

  // **************** Agent Share (visitor-scoped) *************** //

  queryBySender = this.withContext(shareVisitor.queryBySender);
  countBySender = this.withContext(shareVisitor.countBySender);
  countShareVisitors = this.withContext(shareVisitor.countShareVisitors);

  // **************** Create *************** //

  create = this.withContext(create.create);
  batchInsert = this.withContext(create.batchInsert);

  // **************** Delete *************** //

  delete = this.withContext(remove.deleteTopic);
  batchDeleteBySessionId = this.withContext(remove.batchDeleteBySessionId);
  batchDeleteByGroupId = this.withContext(remove.batchDeleteByGroupId);
  batchDeleteByAgentId = this.withContext(remove.batchDeleteByAgentId);
  batchDelete = this.withContext(remove.batchDelete);
  batchDeleteIncludingTrashed = this.withContext(remove.batchDeleteIncludingTrashed);
  deleteAll = this.withContext(remove.deleteAll);

  // **************** Recycle bin *************** //

  softDelete = this.withContext(trash.softDelete);
  softDeleteBySessionId = this.withContext(trash.softDeleteBySessionId);
  softDeleteByGroupId = this.withContext(trash.softDeleteByGroupId);
  softDeleteByAgentId = this.withContext(trash.softDeleteByAgentId);
  softDeleteByParents = this.withContext(trash.softDeleteByParents);
  softDeleteAll = this.withContext(trash.softDeleteAll);
  restore = this.withContext(trash.restore);
  findTrashedByIds = this.withContext(trash.findTrashedByIds);
  purge = this.withContext(trash.purge);

  // **************** Update *************** //

  update = this.withContext(update.update);
  settleRunningStatus = this.withContext(update.settleRunningStatus);
  markRead = this.withContext(update.markRead);
  recomputeUsage = this.withContext(update.recomputeUsage);
  updateMetadata = this.withContext(update.updateMetadata);
  updateModelPin = this.withContext(update.updateModelPin);

  // **************** Running operation marker *************** //

  settleRunningOperation = this.withContext(runningOperation.settleRunningOperation);
  appendRunningOperationChild = this.withContext(runningOperation.appendRunningOperationChild);
  patchRunningOperation = this.withContext(runningOperation.patchRunningOperation);
  removeRunningOperationChild = this.withContext(runningOperation.removeRunningOperationChild);
  updateRunningOperationAssistantMessage = this.withContext(
    runningOperation.updateRunningOperationAssistantMessage,
  );
  takeRunningOperation = this.withContext(runningOperation.takeRunningOperation);
  isRunningOperationAlive = this.withContext(runningOperation.isRunningOperationAlive);

  // **************** Task-callback reservation *************** //

  tryReserveTaskCallback = this.withContext(taskCallback.tryReserveTaskCallback);
  repairAgentInterventionContinuation = this.withContext(
    taskCallback.repairAgentInterventionContinuation,
  );
  releaseTaskCallbackReservation = this.withContext(taskCallback.releaseTaskCallbackReservation);

  // **************** Scheduled run *************** //

  cancelRateLimitContinuation = this.withContext(scheduledRun.cancelRateLimitContinuation);
  armScheduledRun = this.withContext(scheduledRun.armScheduledRun);

  // **************** Memory extraction *************** //

  listTopicsForMemoryExtractor = this.withContext(memoryExtractor.listTopicsForMemoryExtractor);
  countTopicsForMemoryExtractor = this.withContext(memoryExtractor.countTopicsForMemoryExtractor);
  resetMemoryExtractStatus = this.withContext(memoryExtractor.resetMemoryExtractStatus);

  // **************** Scheduled run (backend cron) *************** //

  static getDueScheduledTopics = scheduledRun.getDueScheduledTopics;

  static claimScheduledTopic = scheduledRun.claimScheduledTopic;

  static clearScheduledRun = scheduledRun.clearScheduledRun;

  static repointScheduledRunFailedMessage = scheduledRun.repointScheduledRunFailedMessage;
}
