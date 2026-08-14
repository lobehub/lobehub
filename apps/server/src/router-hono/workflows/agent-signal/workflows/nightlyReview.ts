import type { WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

import { getServerDB } from '@/database/server';
import { createServerNightlyReviewScheduleService } from '@/server/services/agentSignal/services';
import {
  AgentSignalNightlyReviewWorkflow,
  type ExecuteNightlyReviewUserPayload,
  NIGHTLY_REVIEW_EXECUTE_FLOW_CONTROL_KEY,
  NIGHTLY_REVIEW_PAGINATE_FLOW_CONTROL_KEY,
  type NightlyReviewWorkflowUser,
  type PaginateNightlyReviewUsersPayload,
} from '@/server/workflows/agentSignal/nightlyReview';
import { parseWorkflowDate, runStep } from '@/server/workflows/step';

const DEFAULT_PAGE_SIZE = 50;
const HARD_MAX_PAGE_SIZE = 200;
const DEFAULT_TARGET_LIMIT = 20;
const HARD_MAX_TARGET_LIMIT = 50;
const USER_FAN_OUT_CHUNK_SIZE = 20;

/** Dependencies that isolate nightly-review workflow orchestration from storage and child triggers. */
export interface NightlyReviewWorkflowDependencies {
  /** Creates the database-backed scheduler service used inside durable steps. */
  createScheduleService?: typeof createServerNightlyReviewScheduleService;
  /** Resolves the main database connection used by scheduler steps. */
  getDb?: typeof getServerDB;
  /** Triggers the single-user execution layer. */
  triggerExecuteUser?: typeof AgentSignalNightlyReviewWorkflow.triggerExecuteUser;
  /** Triggers a fan-out chunk or the next cursor page. */
  triggerPaginateUsers?: typeof AgentSignalNightlyReviewWorkflow.triggerPaginateUsers;
}

const boundedInteger = (value: number | undefined, fallback: number, maximum: number) =>
  Math.min(Math.max(Math.floor(value ?? fallback), 1), maximum);

const serializeUser = (user: {
  createdAt: string;
  id: string;
  timezone?: string | null;
}): NightlyReviewWorkflowUser => ({
  createdAt: user.createdAt,
  id: user.id,
  timezone: user.timezone,
});

/**
 * Processes one cursor page or one bounded fan-out chunk of nightly-review users.
 *
 * Use when:
 * - Upstash invokes the pagination layer after the cron entry
 * - A parent page splits users into bounded fan-out chunks
 *
 * Expects:
 * - `requestedAt` remains unchanged across the complete pagination tree
 * - Database pages are ordered by `createdAt, id`
 *
 * Returns:
 * - Page/chunk scheduling counts and the next cursor, without executing review logic inline
 *
 * Call stack:
 *
 * paginateNightlyReviewUsers
 *   -> createServerNightlyReviewScheduleService
 *     -> listEligibleUsersPage
 *   -> {@link AgentSignalNightlyReviewWorkflow.triggerPaginateUsers}
 *   -> {@link AgentSignalNightlyReviewWorkflow.triggerExecuteUser}
 */
export const paginateNightlyReviewUsers = async (
  context: WorkflowContext<PaginateNightlyReviewUsersPayload>,
  dependencies: NightlyReviewWorkflowDependencies = {},
) => {
  const payload = context.requestPayload;
  if (!payload?.requestedAt) {
    return { error: 'Missing requestedAt in payload', success: false };
  }

  parseWorkflowDate(payload.requestedAt, 'Invalid nightly review requestedAt');

  const pageSize = boundedInteger(payload.pageSize, DEFAULT_PAGE_SIZE, HARD_MAX_PAGE_SIZE);
  const targetLimit = boundedInteger(
    payload.targetLimit,
    DEFAULT_TARGET_LIMIT,
    HARD_MAX_TARGET_LIMIT,
  );
  const triggerExecuteUser =
    dependencies.triggerExecuteUser ?? AgentSignalNightlyReviewWorkflow.triggerExecuteUser;
  const triggerPaginateUsers =
    dependencies.triggerPaginateUsers ?? AgentSignalNightlyReviewWorkflow.triggerPaginateUsers;

  if (payload.users && payload.users.length > 0) {
    await Promise.all(
      payload.users.map((user) =>
        runStep(context, `agent-signal:nightly-review:execute:${user.id}`, () =>
          triggerExecuteUser({
            requestedAt: payload.requestedAt,
            targetLimit,
            user,
          }),
        ),
      ),
    );

    return { scheduledUsers: payload.users.length, success: true };
  }

  const cursor = payload.cursor
    ? {
        createdAt: parseWorkflowDate(
          payload.cursor.createdAt,
          'Invalid nightly review pagination cursor',
        ),
        id: payload.cursor.id,
      }
    : undefined;
  const createScheduleService =
    dependencies.createScheduleService ?? createServerNightlyReviewScheduleService;
  const getDb = dependencies.getDb ?? getServerDB;
  const page = await runStep(
    context,
    `agent-signal:nightly-review:list-users:${cursor?.id ?? 'root'}`,
    async () => {
      const db = await getDb();
      const service = createScheduleService(db);

      return service.listEligibleUsersPage({
        cursor,
        limit: pageSize,
        whitelist: payload.whitelist,
      });
    },
  );

  const users = page.users.map(serializeUser);
  const batches = chunk(users, USER_FAN_OUT_CHUNK_SIZE);

  await Promise.all(
    batches.map((batchUsers, index) =>
      runStep(context, `agent-signal:nightly-review:fanout:${index + 1}/${batches.length}`, () =>
        triggerPaginateUsers({
          pageSize,
          requestedAt: payload.requestedAt,
          targetLimit,
          users: batchUsers,
          whitelist: payload.whitelist,
        }),
      ),
    ),
  );

  const nextCursor = page.nextCursor
    ? {
        createdAt: page.nextCursor.createdAt,
        id: page.nextCursor.id,
      }
    : undefined;

  if (nextCursor) {
    await runStep(context, `agent-signal:nightly-review:next-page:${nextCursor.id}`, () =>
      triggerPaginateUsers({
        cursor: nextCursor,
        pageSize,
        requestedAt: payload.requestedAt,
        targetLimit,
        whitelist: payload.whitelist,
      }),
    );
  }

  return {
    hasNextPage: Boolean(nextCursor),
    scheduledBatches: batches.length,
    scheduledUsers: users.length,
    success: true,
  };
};

/**
 * Executes nightly-review scheduling for exactly one user.
 *
 * Use when:
 * - The pagination layer has emitted one user item
 *
 * Expects:
 * - The payload contains one stable user and the root schedule timestamp
 *
 * Returns:
 * - Per-user enqueue and skip counts
 *
 * Call stack:
 *
 * executeNightlyReviewUser
 *   -> createServerNightlyReviewScheduleService
 *     -> dispatchNightlyReviewForUser
 *       -> enqueueAgentSignalSourceEvent
 */
export const executeNightlyReviewUser = async (
  context: WorkflowContext<ExecuteNightlyReviewUserPayload>,
  dependencies: NightlyReviewWorkflowDependencies = {},
) => {
  const payload = context.requestPayload;
  if (!payload?.requestedAt || !payload.user?.createdAt || !payload.user.id) {
    return { error: 'Missing requestedAt or user in payload', success: false };
  }

  const requestedAt = parseWorkflowDate(payload.requestedAt, 'Invalid nightly review requestedAt');
  const createdAt = parseWorkflowDate(
    payload.user.createdAt,
    'Invalid nightly review user creation timestamp',
  );
  const targetLimit = boundedInteger(
    payload.targetLimit,
    DEFAULT_TARGET_LIMIT,
    HARD_MAX_TARGET_LIMIT,
  );
  const createScheduleService =
    dependencies.createScheduleService ?? createServerNightlyReviewScheduleService;
  const getDb = dependencies.getDb ?? getServerDB;
  const summary = await runStep(
    context,
    `agent-signal:nightly-review:dispatch-user:${payload.user.id}`,
    async () => {
      const db = await getDb();
      const service = createScheduleService(db);

      return service.dispatchNightlyReviewForUser({
        requestedAt,
        targetLimit,
        user: {
          createdAt,
          id: payload.user.id,
          timezone: payload.user.timezone,
        },
      });
    },
  );

  return { ...summary, success: true, userId: payload.user.id };
};

/**
 * Serve options for serialized cursor pagination.
 *
 * Use when:
 * - Registering the paginate route with Upstash Workflow
 *
 * Expects:
 * - Trigger-side pagination uses the same flow-control key
 *
 * Returns:
 * - One active pagination run with bounded delivery rate
 */
export const paginateNightlyReviewUsersOptions = {
  flowControl: {
    key: NIGHTLY_REVIEW_PAGINATE_FLOW_CONTROL_KEY,
    parallelism: 1,
    ratePerSecond: 5,
  },
};

/**
 * Serve options for bounded per-user execution.
 *
 * Use when:
 * - Registering the execute-user route with Upstash Workflow
 *
 * Expects:
 * - Trigger-side execution uses the same flow-control key
 *
 * Returns:
 * - At most five concurrent user executions
 */
export const executeNightlyReviewUserOptions = {
  flowControl: {
    key: NIGHTLY_REVIEW_EXECUTE_FLOW_CONTROL_KEY,
    parallelism: 5,
    ratePerSecond: 5,
  },
};
