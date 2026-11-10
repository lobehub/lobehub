import type { WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

import { getServerDB } from '@/database/server';
import {
  createServerNightlyReviewScheduleService,
  getLocalNightWindow,
} from '@/server/services/agentSignal/services';
import { BotRetroService } from '@/server/services/agentSignal/services/botRetro';
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
  /** Creates the per-user bot retro service used by the `bot-retro` job. */
  createBotRetroService?: (
    db: Awaited<ReturnType<typeof getServerDB>>,
    userId: string,
  ) => {
    listTargets: BotRetroService['listTargets'];
    runForAgent: BotRetroService['runForAgent'];
  };
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

  const job = payload.job ?? 'self-review';
  // Self-review keeps its original step names so runs in flight across a deploy replay cleanly.
  const stepPrefix =
    job === 'self-review' ? 'agent-signal:nightly-review' : 'agent-signal:nightly-bot-retro';
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
        runStep(context, `${stepPrefix}:execute:${user.id}`, () =>
          triggerExecuteUser({
            job,
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
    `${stepPrefix}:list-users:${cursor?.id ?? 'root'}`,
    async () => {
      const db = await getDb();
      const service = createScheduleService(db);

      return service.listEligibleUsersPage({
        cursor,
        job,
        limit: pageSize,
        requestedAt: parseWorkflowDate(payload.requestedAt, 'Invalid nightly review requestedAt'),
        whitelist: payload.whitelist,
      });
    },
  );

  const users = page.users.map(serializeUser);
  const batches = chunk(users, USER_FAN_OUT_CHUNK_SIZE);

  await Promise.all(
    batches.map((batchUsers, index) =>
      runStep(context, `${stepPrefix}:fanout:${index + 1}/${batches.length}`, () =>
        triggerPaginateUsers({
          job,
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
    await runStep(context, `${stepPrefix}:next-page:${nextCursor.id}`, () =>
      triggerPaginateUsers({
        cursor: nextCursor,
        job,
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
  const getDb = dependencies.getDb ?? getServerDB;

  if (payload.job === 'bot-retro') {
    return executeBotRetroUser(context, {
      createBotRetroService: dependencies.createBotRetroService,
      getDb,
      requestedAt,
      targetLimit,
    });
  }

  const createScheduleService =
    dependencies.createScheduleService ?? createServerNightlyReviewScheduleService;
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
 * Runs the `bot-retro` job for one user: one durable step lists the agents that worked in a bot
 * topic on the user's previous local day, then one step per agent writes its retro, so a failed
 * agent retries alone.
 *
 * Call stack:
 *
 * executeNightlyReviewUser (job: 'bot-retro')
 *   -> executeBotRetroUser
 *     -> {@link BotRetroService.listTargets}
 *     -> {@link BotRetroService.runForAgent}
 */
const executeBotRetroUser = async (
  context: WorkflowContext<ExecuteNightlyReviewUserPayload>,
  options: {
    createBotRetroService?: NightlyReviewWorkflowDependencies['createBotRetroService'];
    getDb: typeof getServerDB;
    requestedAt: Date;
    targetLimit: number;
  },
) => {
  const { user } = context.requestPayload;
  const window = getLocalNightWindow(options.requestedAt, user.timezone, 'bot-retro');

  if (!window.withinWindow) return { enqueued: 0, skipped: 1, success: true, userId: user.id };

  const createService =
    options.createBotRetroService ??
    ((db: Awaited<ReturnType<typeof getServerDB>>, userId: string) =>
      new BotRetroService(db, userId));
  const withService = async () => createService(await options.getDb(), user.id);

  const agentIds = await runStep(
    context,
    `agent-signal:nightly-bot-retro:list-agents:${user.id}`,
    async () =>
      (await withService()).listTargets({
        limit: options.targetLimit,
        windowEnd: window.reviewWindowEnd,
        windowStart: window.reviewWindowStart,
      }),
  );

  for (const agentId of agentIds) {
    await runStep(context, `agent-signal:nightly-bot-retro:run:${agentId}`, async () =>
      (await withService()).runForAgent({
        agentId,
        localDate: window.localDate,
        windowEnd: window.reviewWindowEnd,
        windowStart: window.reviewWindowStart,
      }),
    );
  }

  return { enqueued: agentIds.length, skipped: 0, success: true, userId: user.id };
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
