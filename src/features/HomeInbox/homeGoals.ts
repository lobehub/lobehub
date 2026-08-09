import { getGoalPresentation } from '@/features/AgentGoals/goalPresentation';
import type { GoalListItem } from '@/store/goal/initialState';

/** Past this the rail card stops being a card and starts being a page. */
export const HOME_GOAL_COLLAPSED_COUNT = 5;

export type HomeGoalBucket = 'review' | 'running';

export interface HomeGoalEntry {
  agentId: string | null;
  bucket: HomeGoalBucket;
  id: string;
  identifier: string;
  maxRounds: number | null;
  rounds: number;
  /** Key in the `chat` namespace — the same label the goal pages use. */
  statusKey: GoalStatusKey;
  title: string;
}

/**
 * Home carries the two states a long-running goal is *in flight* in: waiting on
 * the user, or working. Everything else — achieved, canceled, paused, failed —
 * is either finished or already reported through the briefs feed, and a
 * dashboard glance that listed them too would stop being a glance.
 */
const BUCKET_BY_STATUS_KEY = {
  'goalList.status.planning': 'running',
  'goalList.status.review': 'review',
  'goalList.status.running': 'running',
  'goalList.status.verifying': 'running',
  'goalList.status.waiting': 'running',
} as const satisfies Record<string, HomeGoalBucket>;

/** The `goalList.status.*` keys an open goal resolves to — a `chat` locale key. */
type GoalStatusKey = keyof typeof BUCKET_BY_STATUS_KEY;

const isOpenGoalStatus = (statusKey: string): statusKey is GoalStatusKey =>
  statusKey in BUCKET_BY_STATUS_KEY;

/** Actionable first: a delivered goal is blocked on the user, a running one isn't. */
const BUCKET_ORDER: HomeGoalBucket[] = ['review', 'running'];

interface AcceptanceSubjectRow {
  status: string;
  subjectId: string;
  subjectType: string;
}

/**
 * Acceptance status per goal task, from the one list read the home rail makes.
 * Per-goal `getBySubject` calls would be one request per row; the list is newest
 * first, so the first row seen for a subject is the one that counts.
 */
export const indexAcceptanceStatuses = (
  acceptances: AcceptanceSubjectRow[] = [],
): Record<string, string> => {
  const byTaskId: Record<string, string> = {};

  for (const { status, subjectId, subjectType } of acceptances) {
    if (subjectType !== 'task' || subjectId in byTaskId) continue;
    byTaskId[subjectId] = status;
  }

  return byTaskId;
};

const goalTitle = (goal: GoalListItem) =>
  goal.name?.trim() || goal.instruction.trim() || goal.identifier;

/**
 * The rail's goal rows, bucketed and ordered.
 *
 * A goal whose acceptance isn't in the index falls back to its task status,
 * which reads `completed` as "pending acceptance" — right until the moment it is
 * accepted. That window only opens for goals older than the acceptance feed's
 * page, i.e. far below the rail's own cut.
 */
export const buildHomeGoalEntries = (
  goals: GoalListItem[],
  acceptanceStatusByTaskId: Record<string, string> = {},
): HomeGoalEntry[] => {
  const entries = goals.flatMap<HomeGoalEntry>((goal) => {
    const config = goal.config as { goal?: { maxIterations?: number | null } } | null;
    const maxRounds = config?.goal?.maxIterations ?? null;
    const rounds = goal.totalTopics ?? 0;
    const { statusKey } = getGoalPresentation({
      acceptanceStatus: acceptanceStatusByTaskId[goal.id],
      maxRounds,
      rounds,
      taskStatus: goal.status,
    });
    if (!isOpenGoalStatus(statusKey)) return [];

    return [
      {
        agentId: goal.assigneeAgentId ?? null,
        bucket: BUCKET_BY_STATUS_KEY[statusKey],
        id: goal.id,
        identifier: goal.identifier,
        maxRounds,
        rounds,
        statusKey,
        title: goalTitle(goal),
      },
    ];
  });

  return BUCKET_ORDER.flatMap((bucket) => entries.filter((entry) => entry.bucket === bucket));
};

export interface HomeGoalBucketView {
  bucket: HomeGoalBucket;
  /** The rows to render — the truncated view when the card is collapsed. */
  entries: HomeGoalEntry[];
  /** The whole pile, so a truncated card never under-reports its backlog. */
  total: number;
}

/**
 * What the card draws: named piles, plus whether a tail is folded away.
 *
 * A long list would push every card below it off the rail, so the card stays a
 * card and the tail is one click away. The cut runs across the ordered list
 * rather than per pile — the goals waiting on the user come first, so it is
 * always the least urgent rows that fold.
 */
export const resolveHomeGoalView = (
  entries: HomeGoalEntry[],
  expanded = false,
): { buckets: HomeGoalBucketView[]; collapsed: boolean } => {
  const collapsed = !expanded && entries.length > HOME_GOAL_COLLAPSED_COUNT;
  const shown = collapsed ? entries.slice(0, HOME_GOAL_COLLAPSED_COUNT) : entries;

  return {
    buckets: BUCKET_ORDER.map((bucket) => ({
      bucket,
      entries: shown.filter((entry) => entry.bucket === bucket),
      total: entries.filter((entry) => entry.bucket === bucket).length,
    })).filter(({ entries: rows }) => rows.length > 0),
    collapsed,
  };
};

/** Where a goal row goes: its own detail page under the agent that owns it. */
export const homeGoalHref = (entry: HomeGoalEntry): string | undefined =>
  entry.agentId ? `/agent/${entry.agentId}/goal/${entry.identifier}` : undefined;
