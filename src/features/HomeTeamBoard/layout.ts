import type { AgentRunBoardLane, AgentRunBoardRun, AgentRunBoardRunStatus } from '@lobechat/types';

/** Short runs still need a mark wide enough to see and click. */
export const MIN_BAR_PERCENT = 0.8;
/** Past this an agent stops growing; the rest are counted. */
export const MAX_TOPIC_ROWS = 5;
const TICK_COUNT = 6;
/** Past this a title would run off the axis, so it hangs back from the bar's end. */
const LABEL_FLIP_PERCENT = 60;

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
  title: string | null;
  topicId: string | null;
}

export interface LaneLayout {
  /** Topics that did not fit in {@link MAX_TOPIC_ROWS}. */
  overflow: number;
  rows: TopicRow[];
}

const toPercent = (time: number, start: number, end: number) =>
  Math.min(100, Math.max(0, ((time - start) / (end - start)) * 100));

const placeRun = (
  run: AgentRunBoardRun,
  start: number,
  end: number,
  windowEnd: Date,
): PlacedRun => {
  const from = toPercent(run.startedAt.getTime(), start, end);
  const to = toPercent((run.endedAt ?? windowEnd).getTime(), start, end);
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
  windowEnd: Date,
): LaneLayout => {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  const groups = Map.groupBy(runs, (run) => run.topicId ?? run.id);

  const rows = [...groups.entries()]
    .map(([key, group]): TopicRow => {
      const ordered = [...group].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

      return {
        key,
        runs: ordered.map((run) => placeRun(run, start, end, windowEnd)),
        title: ordered.findLast((run) => run.title)?.title ?? null,
        topicId: ordered[0].topicId,
      };
    })
    .sort((a, b) => rowRank(a.runs) - rowRank(b.runs) || latestStart(b.runs) - latestStart(a.runs));

  return {
    overflow: Math.max(0, rows.length - MAX_TOPIC_ROWS),
    rows: rows.slice(0, MAX_TOPIC_ROWS),
  };
};

export interface RowLabelPlacement {
  anchor: 'end' | 'start';
  /** Distance from that edge of the axis, as a percentage. */
  offset: number;
}

/**
 * Where a topic's title sits along its row: from the first bar's start, or back
 * from the last bar's end when the row begins too far along to fit it.
 */
export const resolveRowLabel = (runs: PlacedRun[]): RowLabelPlacement => {
  const first = runs[0];
  if (first.left <= LABEL_FLIP_PERCENT) return { anchor: 'start', offset: first.left };

  const last = runs.at(-1)!;
  return { anchor: 'end', offset: Math.max(0, 100 - (last.left + last.width)) };
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

/** Evenly spaced times along the axis, the last one being its end. */
export const buildAxisTicks = (windowStart: Date, windowEnd: Date): Date[] => {
  const start = windowStart.getTime();
  const step = (windowEnd.getTime() - start) / TICK_COUNT;

  return Array.from({ length: TICK_COUNT + 1 }, (_, i) => new Date(start + step * i));
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
