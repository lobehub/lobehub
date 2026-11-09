import {
  agentDisplayName,
  type AgentRunBoardActivityBucket,
  type AgentRunBoardAttentionItem,
  type AgentRunBoardData,
  type AgentRunBoardFilterOptions,
  type AgentRunBoardLane,
  type AgentRunBoardRun,
  type AgentRunBoardRunStatus,
} from '@lobechat/types';

import type {
  AgentRunBoardInterventionRow,
  AgentRunBoardRow,
} from '@/database/models/agentRunBoard';

import { HETERO_OPERATION_SILENCE_MS, isOperationLeaseFresh } from '../agentRuntime/operationLease';

const MAX_LANES = 30;
const MAX_FAILED_ATTENTION = 20;
const MAX_DETAIL_LENGTH = 200;
const ACTIVITY_BUCKETS = 24;
/** An hour reads better in whole 5-minute slices. */
const SHORT_WINDOW_BUCKETS = 12;
const HOUR_MS = 60 * 60_000;

const pendingInterventions = (row: AgentRunBoardRow, now: number): AgentRunBoardInterventionRow[] =>
  // Interventions time out lazily on read, so a past deadline can still say `pending`.
  row.interventions.filter((i) => i.status === 'pending' && i.deadline.getTime() > now);

/**
 * Turn a stored operation status into what the team should believe. `running`
 * alone is unreliable: dead rows keep it until something settles them, so a
 * row without a fresh lease reads as stopped rather than as live work.
 */
export const classifyRun = (row: AgentRunBoardRow, now: number): AgentRunBoardRunStatus | null => {
  const leaseFresh = isOperationLeaseFresh(row, {
    heterogeneous: Boolean(row.heteroType),
    now,
  });

  switch (row.status) {
    case 'done': {
      return 'done';
    }
    case 'error':
    case 'abandoned': {
      return 'failed';
    }
    case 'interrupted': {
      return 'stopped';
    }
    case 'running': {
      return leaseFresh ? 'running' : 'stopped';
    }
    // Parked on something external: no step heartbeat, so only the long window applies.
    case 'waiting_for_async_tool':
    case 'waiting_for_client': {
      return now - row.updatedAt.getTime() < HETERO_OPERATION_SILENCE_MS ? 'running' : 'stopped';
    }
    case 'waiting_for_human': {
      if (row.interventions.length === 0 || pendingInterventions(row, now).length > 0)
        return 'needs_human';
      // Every ask was answered or expired, but the row may stay parked until the run ends.
      return leaseFresh ? 'running' : 'stopped';
    }
    default: {
      return null;
    }
  }
};

// Not the thread's title: a click opens the parent topic, so the label has to match it.
const runTitle = (row: AgentRunBoardRow) => row.taskName || row.topicTitle || null;

/** Only the viewer's own run: the marker is what the drawer reattaches to the stream with. */
const ownRunningOperation = (row: AgentRunBoardRow, viewerId: string) =>
  row.userId === viewerId && row.runningOperation?.operationId === row.id
    ? row.runningOperation
    : null;

// `title` is becoming a role marker; people know an agent by its `name`.
const agentLabel = (row: AgentRunBoardRow) =>
  agentDisplayName({ name: row.agentName, title: row.agentTitle }) ?? null;

const oldestPending = (row: AgentRunBoardRow, now: number) =>
  pendingInterventions(row, now).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

const toRun = (
  row: AgentRunBoardRow,
  status: AgentRunBoardRunStatus,
  now: number,
  viewerId: string,
): AgentRunBoardRun => ({
  endedAt:
    status === 'running' || status === 'needs_human' ? null : (row.completedAt ?? row.updatedAt),
  id: row.id,
  model: row.model,
  runningOperation:
    status === 'running' || status === 'needs_human' ? ownRunningOperation(row, viewerId) : null,
  startedAt: row.startedAt ?? row.createdAt,
  status,
  title: runTitle(row),
  topicId: row.topicId,
  trigger: row.trigger,
  userId: row.userId,
  waitingSince:
    status === 'needs_human' ? (oldestPending(row, now)?.createdAt ?? row.updatedAt) : null,
});

const laneRank = (lane: AgentRunBoardLane) => {
  const has = (status: AgentRunBoardRunStatus) => lane.runs.some((r) => r.status === status);
  if (has('needs_human')) return 0;
  if (has('failed')) return 1;
  if (has('running')) return 2;
  return 3;
};

const latestStart = (lane: AgentRunBoardLane) =>
  Math.max(...lane.runs.map((r) => r.startedAt.getTime()));

const attentionBase = (row: AgentRunBoardRow, viewerId: string) => ({
  agentAvatar: row.agentAvatar,
  agentBackgroundColor: row.agentBackgroundColor,
  agentId: row.agentId,
  agentTitle: agentLabel(row),
  operationId: row.id,
  runningOperation: ownRunningOperation(row, viewerId),
  title: runTitle(row),
  topicId: row.topicId,
});

const toNeedsHuman = (
  row: AgentRunBoardRow,
  viewerId: string,
  now: number,
): AgentRunBoardAttentionItem => {
  const first = oldestPending(row, now);
  const ownerUserId = first?.userId ?? row.userId;

  return {
    ...attentionBase(row, viewerId),
    detail: null,
    isMine: ownerUserId === viewerId,
    kind: 'needs_human',
    ownerUserId,
    since: first?.createdAt ?? row.updatedAt,
  };
};

const toFailed = (row: AgentRunBoardRow, viewerId: string): AgentRunBoardAttentionItem => ({
  ...attentionBase(row, viewerId),
  detail: (row.errorMessage || row.errorType)?.slice(0, MAX_DETAIL_LENGTH) ?? null,
  isMine: row.userId === viewerId,
  kind: 'failed',
  ownerUserId: row.userId,
  since: row.completedAt ?? row.updatedAt,
});

/**
 * Counted from every visible run, not the capped lanes, so the chart stays true
 * for a workspace with more agents than the timeline shows. A run that began
 * before the window lands in its first slice.
 */
const buildActivity = (
  runs: AgentRunBoardRun[],
  windowStart: Date,
  generatedAt: Date,
): AgentRunBoardActivityBucket[] => {
  const start = windowStart.getTime();
  const span = generatedAt.getTime() - start;
  const bucketCount = span <= HOUR_MS ? SHORT_WINDOW_BUCKETS : ACTIVITY_BUCKETS;
  const step = span / bucketCount;
  const buckets: AgentRunBoardActivityBucket[] = Array.from(
    { length: bucketCount },
    (_, index) => ({
      done: 0,
      failed: 0,
      needsHuman: 0,
      running: 0,
      startedAt: new Date(start + step * index),
    }),
  );

  for (const run of runs) {
    if (run.status === 'stopped') continue;
    const index = Math.floor((run.startedAt.getTime() - start) / step);
    const bucket = buckets[Math.min(bucketCount - 1, Math.max(0, index))];
    if (run.status === 'needs_human') bucket.needsHuman += 1;
    else bucket[run.status] += 1;
  }

  return buckets;
};

/** Runs the viewer started, spoke in (`spokenTopicIds`), or is asked to approve. */
const buildFilterOptions = (rows: AgentRunBoardRow[]): AgentRunBoardFilterOptions => ({
  agents: [
    ...new Map(rows.map((r) => [r.agentId, { id: r.agentId, title: agentLabel(r) }])).values(),
  ],
  memberIds: [...new Set(rows.map((r) => r.userId))],
});

/** Narrow to one agent and/or the member who started the run. */
export const filterRunsBy = (
  rows: AgentRunBoardRow[],
  { agentId, userId }: { agentId?: string; userId?: string },
) =>
  rows.filter((row) => (!agentId || row.agentId === agentId) && (!userId || row.userId === userId));

export const buildAgentRunBoard = ({
  filterOptionRows,
  generatedAt,
  rows,
  viewerId,
  windowStart,
}: {
  /** The rows before the agent and member picks, so picking one keeps the others offered. */
  filterOptionRows?: AgentRunBoardRow[];
  generatedAt: Date;
  rows: AgentRunBoardRow[];
  viewerId: string;
  windowStart: Date;
}): AgentRunBoardData => {
  const now = generatedAt.getTime();
  const summary = { done: 0, failed: 0, needsHuman: 0, running: 0 };
  const lanesByAgent = new Map<string, AgentRunBoardLane>();
  const needsHuman: AgentRunBoardAttentionItem[] = [];
  const failed: AgentRunBoardAttentionItem[] = [];
  const visibleRuns: AgentRunBoardRun[] = [];

  for (const row of rows) {
    const status = classifyRun(row, now);
    if (!status) continue;

    const run = toRun(row, status, now, viewerId);
    // A dead row keeps a recent `created_at`, but it can have stopped before the window.
    if (run.endedAt && run.endedAt.getTime() < windowStart.getTime()) continue;

    visibleRuns.push(run);
    if (status === 'running') summary.running += 1;
    if (status === 'done') summary.done += 1;
    if (status === 'needs_human') {
      summary.needsHuman += 1;
      needsHuman.push(toNeedsHuman(row, viewerId, now));
    }
    if (status === 'failed') {
      summary.failed += 1;
      failed.push(toFailed(row, viewerId));
    }

    const lane = lanesByAgent.get(row.agentId);
    if (lane) {
      lane.runs.push(run);
      continue;
    }
    lanesByAgent.set(row.agentId, {
      agentId: row.agentId,
      avatar: row.agentAvatar,
      backgroundColor: row.agentBackgroundColor,
      ownerUserId: row.agentOwnerId,
      runs: [run],
      title: agentLabel(row),
    });
  }

  const lanes = [...lanesByAgent.values()].sort(
    (a, b) => laneRank(a) - laneRank(b) || latestStart(b) - latestStart(a),
  );

  return {
    activity: buildActivity(visibleRuns, windowStart, generatedAt),
    attention: [
      // Mine first, then the longest wait: what the viewer can unblock leads.
      ...needsHuman.sort(
        (a, b) => Number(b.isMine) - Number(a.isMine) || a.since.getTime() - b.since.getTime(),
      ),
      ...failed
        .sort((a, b) => b.since.getTime() - a.since.getTime())
        .slice(0, MAX_FAILED_ATTENTION),
    ],
    filterOptions: buildFilterOptions(filterOptionRows ?? rows),
    generatedAt,
    hiddenLaneCount: Math.max(0, lanes.length - MAX_LANES),
    lanes: lanes.slice(0, MAX_LANES),
    summary,
    windowStart,
  };
};
