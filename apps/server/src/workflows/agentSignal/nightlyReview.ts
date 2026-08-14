import type { FlowControl } from '@upstash/qstash';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { workflowClient } from '@/libs/qstash';

const log = debug('lobe-server:workflows:agent-signal:nightly-review');

const WORKFLOW_PATHS = {
  executeUser: '/api/workflows/agent-signal/execute-nightly-review-user',
  paginateUsers: '/api/workflows/agent-signal/paginate-nightly-review-users',
} as const;

/**
 * Stable flow-control key for nightly-review pagination.
 *
 * Use when:
 * - Triggering or serving a pagination workflow
 *
 * Expects:
 * - Trigger-side and serve-side configuration use the same key
 *
 * Returns:
 * - A global serialization key for bounded cursor traversal
 */
export const NIGHTLY_REVIEW_PAGINATE_FLOW_CONTROL_KEY =
  'agent-signal.nightly-review.paginate-users';

/**
 * Stable flow-control key for per-user nightly-review execution.
 *
 * Use when:
 * - Triggering or serving a single-user execution workflow
 *
 * Expects:
 * - Trigger-side and serve-side configuration use the same key
 *
 * Returns:
 * - A global concurrency key for bounded user fan-out
 */
export const NIGHTLY_REVIEW_EXECUTE_FLOW_CONTROL_KEY = 'agent-signal.nightly-review.execute-user';

/** Serialized stable cursor passed between nightly-review pagination workflows. */
export interface NightlyReviewWorkflowCursor {
  /** ISO timestamp of the last user in the previous page. */
  createdAt: string;
  /** Stable id of the last user in the previous page. */
  id: string;
}

/** One user item passed from pagination to a single-user execution workflow. */
export interface NightlyReviewWorkflowUser {
  /** ISO creation timestamp retained for stable item identity across workflow boundaries. */
  createdAt: string;
  /** Stable user id. */
  id: string;
  /** IANA timezone used to determine whether the user is in the local night window. */
  timezone?: string | null;
}

/** Payload for one cursor page or one bounded fan-out chunk. */
export interface PaginateNightlyReviewUsersPayload {
  /** Cursor from the previous page; absent for the first page or a fan-out chunk. */
  cursor?: NightlyReviewWorkflowCursor;
  /** Number of users read from the database in one page. */
  pageSize: number;
  /** UTC instant shared by the complete pagination tree. */
  requestedAt: string;
  /** Maximum active agents dispatched for each user. */
  targetLimit: number;
  /** Users supplied by a fan-out chunk; each is scheduled for one execution workflow. */
  users?: NightlyReviewWorkflowUser[];
  /** Optional user allowlist for targeted backfills and tests. */
  whitelist?: string[];
}

/** Payload for a workflow that processes exactly one nightly-review user. */
export interface ExecuteNightlyReviewUserPayload {
  /** UTC instant shared by the complete pagination tree. */
  requestedAt: string;
  /** Maximum active agents dispatched for this user. */
  targetLimit: number;
  /** The single user owned by this workflow run. */
  user: NightlyReviewWorkflowUser;
}

const getWorkflowUrl = (path: string): string => {
  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

  if (!baseUrl) {
    throw new Error('INTERNAL_APP_URL or APP_URL is required to trigger nightly review workflows');
  }

  return new URL(path, baseUrl).toString();
};

const getTriggerHeaders = (): Record<string, string> => {
  const headers = new Headers();

  // Upstash forwards user headers only when they are supplied to `trigger`, so trace context must
  // cross every pagination/execution network hop explicitly.
  injectActiveTraceHeaders(headers);

  return Object.fromEntries(headers.entries());
};

/**
 * Triggers the cursor-pagination and single-user layers of nightly review scheduling.
 *
 * Use when:
 * - The cron entry needs to start a bounded user pagination tree
 * - The pagination layer needs to fan out user executions or continue with the next cursor
 *
 * Expects:
 * - Payload timestamps and cursors are JSON-safe ISO strings
 * - Source-event idempotency remains owned by the Agent Signal execution layer
 *
 * Returns:
 * - Upstash workflow trigger metadata for the newly scheduled child run
 *
 * Call stack:
 *
 * scheduleNightlyReview
 *   -> {@link AgentSignalNightlyReviewWorkflow.triggerPaginateUsers}
 *     -> paginateNightlyReviewUsers
 *       -> {@link AgentSignalNightlyReviewWorkflow.triggerExecuteUser}
 *         -> executeNightlyReviewUser
 */
export class AgentSignalNightlyReviewWorkflow {
  /** Triggers one database page or one bounded fan-out chunk. */
  static triggerPaginateUsers(payload: PaginateNightlyReviewUsersPayload) {
    log('Triggering nightly review user pagination payload=%O', {
      cursor: payload.cursor,
      pageSize: payload.pageSize,
      users: payload.users?.length ?? 0,
    });

    return workflowClient.trigger({
      body: payload,
      flowControl: {
        key: NIGHTLY_REVIEW_PAGINATE_FLOW_CONTROL_KEY,
        parallelism: 1,
      } satisfies FlowControl,
      headers: getTriggerHeaders(),
      url: getWorkflowUrl(WORKFLOW_PATHS.paginateUsers),
    });
  }

  /** Triggers one workflow that processes exactly one user. */
  static triggerExecuteUser(payload: ExecuteNightlyReviewUserPayload) {
    log('Triggering nightly review execution userId=%s', payload.user.id);

    return workflowClient.trigger({
      body: payload,
      flowControl: {
        key: NIGHTLY_REVIEW_EXECUTE_FLOW_CONTROL_KEY,
        parallelism: 5,
      } satisfies FlowControl,
      headers: getTriggerHeaders(),
      url: getWorkflowUrl(WORKFLOW_PATHS.executeUser),
    });
  }
}
