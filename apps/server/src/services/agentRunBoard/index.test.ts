// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { AgentRunBoardRow } from '@/database/models/agentRunBoard';

import { buildAgentRunBoard, classifyRun, filterRunsBy } from './index';

const generatedAt = new Date('2026-11-08T12:00:00Z');
const now = generatedAt.getTime();
const windowStart = new Date('2026-11-08T06:00:00Z');
const minutesAgo = (m: number) => new Date(now - m * 60_000);

const row = (overrides: Partial<AgentRunBoardRow> = {}): AgentRunBoardRow => ({
  agentAvatar: null,
  agentBackgroundColor: null,
  agentId: 'a1',
  agentName: null,
  agentOwnerId: 'owner',
  agentTitle: 'Agent',
  completedAt: null,
  createdAt: minutesAgo(30),
  errorMessage: null,
  errorType: null,
  heteroType: null,
  id: 'op',
  interventions: [],
  model: 'm',
  startedAt: minutesAgo(30),
  status: 'running',
  runningOperation: null,
  taskName: null,
  topicId: 't',
  topicTitle: 'Topic',
  trigger: 'chat',
  updatedAt: minutesAgo(1),
  userId: 'teammate',
  ...overrides,
});

const intervention = (overrides = {}) => ({
  createdAt: minutesAgo(14),
  deadline: minutesAgo(-60),
  operationId: 'op',
  status: 'pending',
  userId: 'teammate',
  ...overrides,
});

describe('classifyRun', () => {
  it('treats a running row with a frozen lease as stopped', () => {
    expect(classifyRun(row(), now)).toBe('running');
    expect(classifyRun(row({ updatedAt: minutesAgo(6) }), now)).toBe('stopped');
  });

  it('gives heterogeneous runs the longer silence window', () => {
    expect(classifyRun(row({ heteroType: 'claude-code', updatedAt: minutesAgo(30) }), now)).toBe(
      'running',
    );
  });

  it('needs a human while an ask is pending or no intervention row exists', () => {
    const waiting = { status: 'waiting_for_human' as const, updatedAt: minutesAgo(20) };
    expect(classifyRun(row({ ...waiting, interventions: [intervention()] }), now)).toBe(
      'needs_human',
    );
    expect(classifyRun(row(waiting), now)).toBe('needs_human');
  });

  it('stops counting an ask that expired or was answered', () => {
    const waiting = { status: 'waiting_for_human' as const, updatedAt: minutesAgo(20) };
    expect(
      classifyRun(
        row({ ...waiting, interventions: [intervention({ deadline: minutesAgo(1) })] }),
        now,
      ),
    ).toBe('stopped');
    expect(
      classifyRun(
        row({
          interventions: [intervention({ status: 'resolved' })],
          status: 'waiting_for_human',
          updatedAt: minutesAgo(1),
        }),
        now,
      ),
    ).toBe('running');
  });

  it('skips reserved idle rows and maps terminal statuses', () => {
    expect(classifyRun(row({ status: 'idle' }), now)).toBeNull();
    expect(classifyRun(row({ status: 'abandoned' }), now)).toBe('failed');
    expect(classifyRun(row({ status: 'interrupted' }), now)).toBe('stopped');
  });
});

describe('buildAgentRunBoard', () => {
  const build = (rows: AgentRunBoardRow[], viewerId = 'me') =>
    buildAgentRunBoard({ generatedAt, rows, viewerId, windowStart });

  it('groups by agent and counts each status', () => {
    const board = build([
      row({ id: '1' }),
      row({ completedAt: minutesAgo(2), id: '2', status: 'done' }),
      row({ agentId: 'a2', completedAt: minutesAgo(3), id: '3', status: 'error' }),
    ]);

    expect(board.summary).toEqual({ done: 1, failed: 1, needsHuman: 0, running: 1 });
    expect(board.lanes.map((l) => l.agentId)).toEqual(['a2', 'a1']);
    expect(board.lanes[1].runs).toHaveLength(2);
  });

  it('puts the asks the viewer can answer first, then the longest wait', () => {
    const waiting = { status: 'waiting_for_human' as const, updatedAt: minutesAgo(1) };
    const board = build([
      row({
        ...waiting,
        id: 'older-team',
        interventions: [intervention({ createdAt: minutesAgo(50), operationId: 'older-team' })],
      }),
      row({
        ...waiting,
        id: 'mine',
        interventions: [intervention({ operationId: 'mine', userId: 'me' })],
      }),
    ]);

    expect(board.attention.map((a) => [a.operationId, a.isMine])).toEqual([
      ['mine', true],
      ['older-team', false],
    ]);
    // Internal tool keys mean nothing to the person who has to act.
    expect(board.attention[0].detail).toBeNull();
    const older = board.lanes[0].runs.find((run) => run.id === 'older-team');
    expect(older?.waitingSince).toEqual(minutesAgo(50));
    expect(board.lanes[0].ownerUserId).toBe('owner');
  });

  it('prefers the task title and truncates failure detail', () => {
    const board = build([
      row({
        completedAt: minutesAgo(1),
        errorMessage: 'x'.repeat(500),
        status: 'error',
        taskName: 'Refund',
      }),
    ]);

    expect(board.attention[0].title).toBe('Refund');
    expect(board.attention[0].detail).toHaveLength(200);
  });

  it('hands the stream marker only to the viewer who started the run', () => {
    const runningOperation = { assistantMessageId: 'msg', operationId: 'op' };
    const mine = build([row({ runningOperation, userId: 'me' })]);
    const theirs = build([row({ runningOperation })]);
    const stale = build([
      row({ runningOperation: { ...runningOperation, operationId: 'newer' }, userId: 'me' }),
    ]);

    expect(mine.lanes[0].runs[0].runningOperation).toEqual(runningOperation);
    expect(theirs.lanes[0].runs[0].runningOperation).toBeNull();
    expect(stale.lanes[0].runs[0].runningOperation).toBeNull();
  });

  it('drops a dead run whose lease froze before the window', () => {
    const board = build([row({ createdAt: minutesAgo(600), updatedAt: minutesAgo(500) })]);

    expect(board.lanes).toEqual([]);
    expect(board.summary.running).toBe(0);
  });

  it('counts started runs per slice, from every run rather than the capped lanes', () => {
    const rows = Array.from({ length: 33 }, (_, i) => row({ agentId: `a${i}`, id: `${i}` }));
    const board = build([
      ...rows,
      row({ completedAt: minutesAgo(1), id: 'old', startedAt: minutesAgo(600), status: 'done' }),
      row({ id: 'dead', updatedAt: minutesAgo(10) }),
    ]);

    expect(board.activity).toHaveLength(24);
    expect(board.activity.at(-2)?.running).toBe(33);
    expect(board.activity[0].done).toBe(1);
    expect(board.activity.reduce((sum, b) => sum + b.running + b.done, 0)).toBe(34);
  });

  it('uses 5-minute slices for the one-hour window', () => {
    const board = buildAgentRunBoard({
      generatedAt,
      rows: [],
      viewerId: 'me',
      windowStart: minutesAgo(60),
    });

    expect(board.activity).toHaveLength(12);
  });

  it('labels an agent by its name, falling back to its title', () => {
    const board = build([
      row({ agentId: 'named', agentName: 'Dario', agentTitle: 'CAO', id: '1' }),
      row({ agentId: 'titled', agentTitle: 'CAO', id: '2' }),
    ]);

    expect(board.lanes.map((lane) => lane.title).sort()).toEqual(['CAO', 'Dario']);
    expect(board.filterOptions.agents.find((a) => a.id === 'named')?.title).toBe('Dario');
  });

  it('caps lanes and reports how many were left out', () => {
    const rows = Array.from({ length: 33 }, (_, i) => row({ agentId: `a${i}`, id: `${i}` }));
    const board = build(rows);

    expect(board.lanes).toHaveLength(30);
    expect(board.hiddenLaneCount).toBe(3);
  });
});

describe('filterRunsBy', () => {
  const rows = [
    row({ agentId: 'a1', id: '1', userId: 'u1' }),
    row({ agentId: 'a2', id: '2', userId: 'u1' }),
    row({ agentId: 'a1', id: '3', userId: 'u2' }),
  ];
  const ids = (filter: { agentId?: string; userId?: string }) =>
    filterRunsBy(rows, filter).map((r) => r.id);

  it('narrows by agent, member, or both', () => {
    expect(ids({ agentId: 'a1' })).toEqual(['1', '3']);
    expect(ids({ userId: 'u1' })).toEqual(['1', '2']);
    expect(ids({ agentId: 'a1', userId: 'u2' })).toEqual(['3']);
    expect(ids({})).toEqual(['1', '2', '3']);
  });

  it('keeps every option offered once a pick narrows the board', () => {
    const board = buildAgentRunBoard({
      filterOptionRows: rows,
      generatedAt,
      rows: filterRunsBy(rows, { agentId: 'a2' }),
      viewerId: 'me',
      windowStart,
    });

    expect(board.lanes.map((lane) => lane.agentId)).toEqual(['a2']);
    expect(board.filterOptions.agents.map((agent) => agent.id)).toEqual(['a1', 'a2']);
    expect(board.filterOptions.memberIds).toEqual(['u1', 'u2']);
  });
});
