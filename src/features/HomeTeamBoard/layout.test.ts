import type { AgentRunBoardRun } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  axisPercent,
  buildAxisTicks,
  buildHourCells,
  extendActivityWithFuture,
  formatDuration,
  layoutLaneTopics,
  MAX_TOPIC_ROWS,
  MIN_BAR_PERCENT,
  NOW_TICK_INDEX,
  resolveRowLabel,
  resolveTopicSpan,
} from './layout';

const start = new Date('2026-11-08T10:00:00Z');
const end = new Date('2026-11-08T11:00:00Z');
const at = (minute: number) => new Date(start.getTime() + minute * 60_000);

const run = (
  id: string,
  from: number,
  to: number | null,
  overrides: Partial<AgentRunBoardRun> = {},
): AgentRunBoardRun => ({
  endedAt: to === null ? null : at(to),
  id,
  model: null,
  runningOperation: null,
  startedAt: at(from),
  status: to === null ? 'running' : 'done',
  title: null,
  topicId: null,
  trigger: null,
  userId: 'u',
  waitingSince: null,
  ...overrides,
});

describe('resolveTopicSpan', () => {
  const placedRuns = (...runs: AgentRunBoardRun[]) =>
    layoutLaneTopics(runs, start, end).rows[0].runs;

  it('covers the idle gap from the first turn to the last', () => {
    const span = resolveTopicSpan(
      placedRuns(run('a', 6, 12, { topicId: 't' }), run('b', 30, 36, { topicId: 't' })),
    );

    expect(span.left).toBeCloseTo(9);
    expect(span.width).toBeCloseTo(45);
    expect(span.endsWaiting).toBe(false);
  });

  it('reaches the end of an earlier turn that outlasts the later ones', () => {
    const span = resolveTopicSpan(
      placedRuns(run('a', 0, 48, { topicId: 't' }), run('b', 6, 12, { topicId: 't' })),
    );

    expect(span.width).toBeCloseTo(72);
  });

  it('includes the minimum width of a very short last turn', () => {
    const span = resolveTopicSpan(
      placedRuns(run('a', 0, 6, { topicId: 't' }), run('b', 30, 30, { topicId: 't' })),
    );

    expect(span.width).toBeCloseTo(45 + MIN_BAR_PERCENT);
  });

  it('flags a topic whose last turn is waiting so the span covers the wait mark', () => {
    const span = resolveTopicSpan(
      placedRuns(
        run('a', 0, 6, { topicId: 't' }),
        run('b', 12, null, { status: 'needs_human', topicId: 't', waitingSince: at(18) }),
      ),
    );

    expect(span.width).toBeCloseTo(27);
    expect(span.endsWaiting).toBe(true);
  });
});

describe('layoutLaneTopics', () => {
  it('positions a run as percentages and extends a live run to the end', () => {
    const { rows } = layoutLaneTopics([run('a', 30, null)], start, end);

    expect(rows[0].runs[0].left).toBeCloseTo(45);
    expect(rows[0].runs[0].width).toBeCloseTo(45);
  });

  it('clamps a run that began before the window', () => {
    const { rows } = layoutLaneTopics([run('a', -30, 6)], start, end);

    expect(rows[0].runs[0].left).toBe(0);
    expect(rows[0].runs[0].width).toBeCloseTo(9);
  });

  it('gives concurrent topics their own rows and lines up turns of one topic', () => {
    const { rows } = layoutLaneTopics(
      [
        run('a1', 0, 10, { title: 'First', topicId: 't1' }),
        run('b', 5, 20, { title: 'Other', topicId: 't2' }),
        run('a2', 30, 40, { title: 'Renamed', topicId: 't1' }),
      ],
      start,
      end,
    );

    expect(rows).toHaveLength(2);
    const t1 = rows.find((row) => row.topicId === 't1');
    expect(t1?.runs.map((p) => p.run.id)).toEqual(['a1', 'a2']);
    expect(t1?.title).toBe('Renamed');
  });

  it('keeps a topic-less run on its own row', () => {
    const { rows } = layoutLaneTopics([run('a', 0, 5), run('b', 10, 15)], start, end);

    expect(rows.map((row) => row.key).sort()).toEqual(['a', 'b']);
  });

  it('leads with topics that need attention', () => {
    const { rows } = layoutLaneTopics(
      [
        run('done', 50, 55, { topicId: 't1' }),
        run('ask', 0, null, { status: 'needs_human', topicId: 't2' }),
      ],
      start,
      end,
    );

    expect(rows[0].topicId).toBe('t2');
  });

  it('counts topics past the cap instead of growing the lane', () => {
    const runs = Array.from({ length: 7 }, (_, i) => run(`r${i}`, i, i + 1));
    const layout = layoutLaneTopics(runs, start, end);

    expect(layout.rows).toHaveLength(MAX_TOPIC_ROWS);
    expect(layout.overflow).toBe(2);
  });

  it('shows every topic once expanded, still reporting the overflow', () => {
    const runs = Array.from({ length: 7 }, (_, i) => run(`r${i}`, i, i + 1));
    const layout = layoutLaneTopics(runs, start, end, { expanded: true });

    expect(layout.rows).toHaveLength(7);
    expect(layout.overflow).toBe(2);
  });

  it('ends a waiting run at the moment it asked', () => {
    const { rows } = layoutLaneTopics(
      [run('a', 0, null, { status: 'needs_human', waitingSince: at(45) })],
      start,
      end,
    );

    expect(rows[0].runs[0].width).toBeCloseTo(67.5);
    expect(rows[0].startedBy).toBe('u');
  });

  it('keeps an instant run visible at the present', () => {
    const { rows } = layoutLaneTopics([run('a', 60, 60)], start, end);

    expect(rows[0].runs[0].width).toBe(MIN_BAR_PERCENT);
    expect(rows[0].runs[0].left).toBeCloseTo(90);
  });
});

describe('resolveRowLabel', () => {
  const placed = (left: number, width: number) => ({
    left,
    run: run('a', 0, 1),
    width,
  });

  it('starts the title at the first bar', () => {
    expect(resolveRowLabel([placed(10, 5), placed(40, 5)])).toEqual({
      anchor: 'start',
      offset: 10,
      room: 90,
    });
  });

  it('keeps a waiting row left of its wait mark, however early it starts', () => {
    const waiting = { ...placed(10, 30), run: run('w', 0, null, { status: 'needs_human' }) };

    expect(resolveRowLabel([waiting])).toEqual({ anchor: 'end', offset: 60, room: 40 });
  });

  it('hangs a late row back from its last bar, using the room on its left', () => {
    expect(resolveRowLabel([placed(70, 5), placed(78, 2)])).toEqual({
      anchor: 'end',
      offset: 20,
      room: 80,
    });
  });
});

describe('buildHourCells', () => {
  const now = new Date(2026, 10, 8, 14, 30);
  const atHour = (hour: number, status: AgentRunBoardRun['status'] = 'done') =>
    run(`r-${hour}-${status}`, 0, 1, { startedAt: new Date(2026, 10, 8, hour, 10), status });
  const lane = (runs: AgentRunBoardRun[]) => [
    { agentId: 'a', avatar: null, backgroundColor: null, runs, title: null },
  ];

  it('lists 24 clock hours ending with the current one', () => {
    const cells = buildHourCells([], now);

    expect(cells).toHaveLength(24);
    expect(cells.at(-1)?.hour).toEqual(new Date(2026, 10, 8, 14));
    expect(cells[0].hour).toEqual(new Date(2026, 10, 7, 15));
  });

  it('puts a run in the hour it started and an older one in the first cell', () => {
    const cells = buildHourCells(
      lane([atHour(14), run('old', 0, 1, { startedAt: new Date(2026, 10, 1) })]),
      now,
    );

    expect(cells.at(-1)?.items.map((i) => i.run.id)).toEqual(['r-14-done']);
    expect(cells[0].items.map((i) => i.run.id)).toEqual(['old']);
  });

  it('leads each hour with what needs attention', () => {
    const cells = buildHourCells(lane([atHour(14), atHour(14, 'needs_human')]), now);

    expect(cells.at(-1)?.items[0].run.status).toBe('needs_human');
  });
});

describe('buildAxisTicks', () => {
  it('puts the present at 90% of the axis', () => {
    const ticks = buildAxisTicks(start, end);

    expect(ticks).toHaveLength(4);
    expect(axisPercent(ticks[NOW_TICK_INDEX], start, end)).toBeCloseTo(90);
    expect(ticks[0]).toEqual(start);
    expect(ticks[NOW_TICK_INDEX]).toEqual(end);
  });
});

describe('extendActivityWithFuture', () => {
  it('appends empty slices after the present', () => {
    const empty = { done: 0, failed: 0, needsHuman: 0, running: 0 };
    const activity = Array.from({ length: 12 }, (_, i) => ({
      ...empty,
      done: 1,
      startedAt: at(i * 5),
    }));
    const extended = extendActivityWithFuture(activity);

    expect(extended).toHaveLength(13);
    expect(extended[12]).toEqual({ ...empty, startedAt: at(60) });
  });
});

describe('formatDuration', () => {
  it.each([
    [45_000, '45s'],
    [14 * 60_000, '14m'],
    [125 * 60_000, '2h 5m'],
    [120 * 60_000, '2h'],
    [72 * 3_600_000, '3d'],
    [-5, '0s'],
  ])('formats %d', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
