import type {
  AgentRunBoardActivityBucket,
  AgentRunBoardLane,
  AgentRunBoardRun,
  AgentRunBoardRunStatus,
} from '@lobechat/types';

/** Short runs still need a mark wide enough to see and click. */
export const MIN_BAR_PERCENT = 0.8;
/** Past this an agent stops growing; the rest are counted. */
export const MAX_TOPIC_ROWS = 5;
/** The window fills the first 90% of the axis; the rest is room for what comes next. */
const FUTURE_RATIO = 1 / 9;
const TICKS_PER_PAST = 3;
/** A title starting past this would run out of room, so it hangs left of its bar's end. */
const LABEL_FLIP_PERCENT = 55;
/** Which of the axis ticks is the present. */
export const NOW_TICK_INDEX = TICKS_PER_PAST;

const STATUS_RANK: Record<AgentRunBoardRunStatus, number> = {
  done: 3,
  failed: 1,
  needs_human: 0,
  running: 2,
  stopped: 3,
};

export interface PlacedRun {
  /** Inline-start offset, as a percentage of the time axis. */
  left: number;
  run: AgentRunBoardRun;
  width: number;
}

export interface TopicRow {
  key: string;
  runs: PlacedRun[];
  /** The member who started the topic. */
  startedBy: string;
  title: string | null;
  topicId: string | null;
  trigger: string | null;
}

export interface LaneLayout {
  /** Topics beyond {@link MAX_TOPIC_ROWS}, whether or not the lane is expanded. */
  overflow: number;
  rows: TopicRow[];
}

/** The present sits at 90% of the axis, leaving the rest for time still to come. */
export const resolveAxisEnd = (windowStart: Date, now: Date) =>
  new Date(now.getTime() + (now.getTime() - windowStart.getTime()) * FUTURE_RATIO);

const toPercent = (time: number, start: number, end: number) =>
  Math.min(100, Math.max(0, ((time - start) / (end - start)) * 100));

const placeRun = (run: AgentRunBoardRun, start: number, end: number, now: Date): PlacedRun => {
  // A run waiting on a person stops at the moment it asked; the wait is a fixed mark there.
  const barEnd = run.waitingSince ?? run.endedAt ?? now;
  const from = toPercent(run.startedAt.getTime(), start, end);
  const to = toPercent(barEnd.getTime(), start, end);
  const width = Math.max(to - from, MIN_BAR_PERCENT);

  return { left: Math.min(from, 100 - width), run, width };
};

const latestStart = (runs: PlacedRun[]) =>
  Math.max(...runs.map(({ run }) => run.startedAt.getTime()));

const rowRank = (runs: PlacedRun[]) => Math.min(...runs.map(({ run }) => STATUS_RANK[run.status]));

/**
 * One row per topic. An agent can serve many conversations at once, so the
 * conversation is what a reader tracks; its turns line up along one row.
 */
export const layoutLaneTopics = (
  runs: AgentRunBoardRun[],
  windowStart: Date,
  now: Date,
  { expanded = false }: { expanded?: boolean } = {},
): LaneLayout => {
  const start = windowStart.getTime();
  const end = resolveAxisEnd(windowStart, now).getTime();
  const groups = Map.groupBy(runs, (run) => run.topicId ?? run.id);

  const rows = [...groups.entries()]
    .map(([key, group]): TopicRow => {
      const ordered = [...group].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

      return {
        key,
        runs: ordered.map((run) => placeRun(run, start, end, now)),
        title: ordered.findLast((run) => run.title)?.title ?? null,
        startedBy: ordered[0].userId,
        topicId: ordered[0].topicId,
        trigger: ordered[0].trigger,
      };
    })
    .sort((a, b) => rowRank(a.runs) - rowRank(b.runs) || latestStart(b.runs) - latestStart(a.runs));

  return {
    overflow: Math.max(0, rows.length - MAX_TOPIC_ROWS),
    rows: expanded ? rows : rows.slice(0, MAX_TOPIC_ROWS),
  };
};

export interface RowLabelPlacement {
  anchor: 'end' | 'start';
  /** Distance from that edge of the axis, as a percentage. */
  offset: number;
  /** The room the title has, as a percentage of the axis. */
  room: number;
}

/**
 * Where a topic's title sits along its row: from the first bar's start, or back
 * from the last bar's end when the row begins too late to fit it or is waiting.
 */
export const resolveRowLabel = (runs: PlacedRun[]): RowLabelPlacement => {
  const first = runs[0];
  const last = runs.at(-1)!;
  // The wait mark sits right after a waiting bar's end, so its title must stop there.
  if (first.left <= LABEL_FLIP_PERCENT && last.run.status !== 'needs_human')
    return { anchor: 'start', offset: first.left, room: 100 - first.left };

  const end = last.left + last.width;
  return { anchor: 'end', offset: 100 - end, room: end };
};

export interface TopicSpan {
  /** Whether the span must also cover the wait mark drawn past its last bar. */
  endsWaiting: boolean;
  left: number;
  width: number;
}

const placedEnd = ({ left, width }: PlacedRun) => left + width;

/** The stretch of a row from the topic's first turn to its last, idle gaps included. */
export const resolveTopicSpan = (runs: PlacedRun[]): TopicSpan => {
  const left = Math.min(...runs.map((placed) => placed.left));
  // Not simply the last run: an earlier turn can outlast the ones started after it.
  const latest = runs.reduce((a, b) => (placedEnd(b) >= placedEnd(a) ? b : a));

  return {
    endsWaiting: latest.run.status === 'needs_human',
    left,
    width: placedEnd(latest) - left,
  };
};

const HOUR_MS = 60 * 60_000;
const DAY_HOURS = 24;

export interface HourCellItem {
  agentId: string;
  run: AgentRunBoardRun;
}

export interface HourCell {
  hour: Date;
  items: HourCellItem[];
}

/**
 * The last 24 clock hours, oldest first, ending with the current one. A run
 * lands in the hour it started; anything older sits in the first cell.
 */
export const buildHourCells = (lanes: AgentRunBoardLane[], now: Date): HourCell[] => {
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const firstHour = currentHour.getTime() - (DAY_HOURS - 1) * HOUR_MS;

  const cells: HourCell[] = Array.from({ length: DAY_HOURS }, (_, index) => ({
    hour: new Date(firstHour + index * HOUR_MS),
    items: [],
  }));

  for (const lane of lanes) {
    for (const run of lane.runs) {
      const index = Math.floor((run.startedAt.getTime() - firstHour) / HOUR_MS);
      cells[Math.min(DAY_HOURS - 1, Math.max(0, index))].items.push({
        agentId: lane.agentId,
        run,
      });
    }
  }

  for (const cell of cells)
    cell.items.sort(
      (a, b) =>
        STATUS_RANK[a.run.status] - STATUS_RANK[b.run.status] ||
        b.run.startedAt.getTime() - a.run.startedAt.getTime(),
    );

  return cells;
};

/** Where a time falls along the axis, as a percentage. */
export const axisPercent = (time: Date, windowStart: Date, now: Date) =>
  toPercent(time.getTime(), windowStart.getTime(), resolveAxisEnd(windowStart, now).getTime());

/** Evenly spaced times up to the present, which is {@link NOW_TICK_INDEX}. */
export const buildAxisTicks = (windowStart: Date, now: Date): Date[] => {
  const start = windowStart.getTime();
  const step = (now.getTime() - start) / TICKS_PER_PAST;

  return Array.from({ length: TICKS_PER_PAST + 1 }, (_, i) => new Date(start + step * i));
};

/** Empty slices after the present, so the chart ends about where the timeline's present sits. */
export const extendActivityWithFuture = (
  activity: AgentRunBoardActivityBucket[],
): AgentRunBoardActivityBucket[] => {
  if (activity.length < 2) return activity;

  const last = activity.at(-1)!.startedAt.getTime();
  const step = last - activity.at(-2)!.startedAt.getTime();
  const future = Array.from({ length: Math.round(activity.length * FUTURE_RATIO) }, (_, i) => ({
    done: 0,
    failed: 0,
    needsHuman: 0,
    running: 0,
    startedAt: new Date(last + step * (i + 1)),
  }));

  return [...activity, ...future];
};

/** A compact duration: `45s`, `14m`, `2h 5m`, `3d`. */
export const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
};
