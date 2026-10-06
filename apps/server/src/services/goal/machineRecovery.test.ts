import { QUOTA_LIMITED_RUN_STATUS, TRANSIENT_FAILED_RUN_STATUS } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { lastAnsweredGateAt, planMachineRecovery } from './machineRecovery';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const SESSION_LIMIT = "You've hit your session limit · resets 4:30am (Asia/Shanghai)";
// 03:50 in Shanghai: the real gate opened 40 minutes before this reset.
const FAILED_AT = new Date('2026-10-05T19:50:01.285Z');
const RESET_AT = new Date('2026-10-05T20:30:00.000Z');

const run = (status: string, updatedAt: Date) => ({ status, updatedAt });

describe('planMachineRecovery', () => {
  describe('usage limits', () => {
    it('waits for the reset the limit names instead of asking anyone', () => {
      const plan = planMachineRecovery({
        error: SESSION_LIMIT,
        now: new Date(FAILED_AT.getTime() + MINUTE),
        runs: [run(QUOTA_LIMITED_RUN_STATUS, FAILED_AT)],
        taskUpdatedAt: FAILED_AT,
      });
      expect(plan).toMatchObject({
        action: 'wait',
        failedAt: FAILED_AT,
        failureClass: 'quota',
        retryAt: new Date(RESET_AT.getTime() + 2 * MINUTE),
      });
    });

    it('retries once the reset (plus margin) has passed', () => {
      expect(
        planMachineRecovery({
          error: SESSION_LIMIT,
          now: new Date(RESET_AT.getTime() + 3 * MINUTE),
          runs: [run(QUOTA_LIMITED_RUN_STATUS, FAILED_AT)],
          taskUpdatedAt: FAILED_AT,
        }),
      ).toEqual({ action: 'retry', failureClass: 'quota' });
    });

    it('backs off 30m, 1h, 2h … when the limit names no reset time', () => {
      const error = "You've hit your session limit";
      const at = (n: number) => new Date(FAILED_AT.getTime() - (n - 1) * MINUTE);
      const first = planMachineRecovery({
        error,
        now: FAILED_AT,
        runs: [run(QUOTA_LIMITED_RUN_STATUS, FAILED_AT)],
        taskUpdatedAt: FAILED_AT,
      });
      expect(first).toMatchObject({ retryAt: new Date(FAILED_AT.getTime() + 30 * MINUTE) });
      const third = planMachineRecovery({
        error,
        now: FAILED_AT,
        runs: [1, 2, 3].map((n) => run(QUOTA_LIMITED_RUN_STATUS, at(n))),
        taskUpdatedAt: FAILED_AT,
      });
      expect(third).toMatchObject({ retryAt: new Date(FAILED_AT.getTime() + 2 * HOUR) });
    });

    it('asks a person once the retries are spent, saying how long it tried', () => {
      const runs = Array.from({ length: 7 }, (_, i) =>
        run(QUOTA_LIMITED_RUN_STATUS, new Date(FAILED_AT.getTime() - i * 3 * HOUR)),
      );
      const plan = planMachineRecovery({
        error: "You've hit your session limit",
        now: FAILED_AT,
        runs,
        taskUpdatedAt: FAILED_AT,
      });
      expect(plan.action).toBe('gate');
      expect(plan.action === 'gate' && plan.reason).toContain('Retried 6 time(s) over 18h');
    });

    it('asks at once when the limit resets more than a day away', () => {
      const plan = planMachineRecovery({
        error: "You've hit your weekly limit · resets Oct 9, 5pm (America/New_York)",
        now: FAILED_AT,
        runs: [run(QUOTA_LIMITED_RUN_STATUS, FAILED_AT)],
        taskUpdatedAt: FAILED_AT,
      });
      expect(plan.action).toBe('gate');
      expect(plan.action === 'gate' && plan.reason).toContain('more than a day away');
    });

    it('does not count limited runs from before the streak was broken', () => {
      const plan = planMachineRecovery({
        error: "You've hit your session limit",
        now: FAILED_AT,
        runs: [
          run(QUOTA_LIMITED_RUN_STATUS, FAILED_AT),
          run('completed', new Date(FAILED_AT.getTime() - HOUR)),
          ...Array.from({ length: 6 }, (_, i) =>
            run(QUOTA_LIMITED_RUN_STATUS, new Date(FAILED_AT.getTime() - (i + 2) * HOUR)),
          ),
        ],
        taskUpdatedAt: FAILED_AT,
      });
      expect(plan).toMatchObject({ action: 'wait', failureClass: 'quota' });
    });
  });

  describe('transient faults', () => {
    const error = '{"error":"TIMEOUT","success":false}';

    it('retries a few times on a short schedule, then asks', () => {
      const one = planMachineRecovery({
        error,
        now: new Date(FAILED_AT.getTime() + MINUTE),
        runs: [run(TRANSIENT_FAILED_RUN_STATUS, FAILED_AT)],
        taskUpdatedAt: FAILED_AT,
      });
      expect(one).toMatchObject({
        action: 'wait',
        retryAt: new Date(FAILED_AT.getTime() + 2 * MINUTE),
      });

      const spent = planMachineRecovery({
        error,
        now: FAILED_AT,
        runs: [0, 30, 40, 42].map((ago) =>
          run(TRANSIENT_FAILED_RUN_STATUS, new Date(FAILED_AT.getTime() - ago * MINUTE)),
        ),
        taskUpdatedAt: FAILED_AT,
      });
      expect(spent.action).toBe('gate');
      expect(spent.action === 'gate' && spent.reason).toContain('Retried 3 time(s)');
    });
  });

  it('gates a broken setup at once, naming what to fix', () => {
    const plan = planMachineRecovery({
      error: 'Working directory does not exist: /Users/user/CodeProjects/LobeHub/lobehub',
      now: FAILED_AT,
      runs: [run('failed', FAILED_AT)],
      taskUpdatedAt: FAILED_AT,
    });
    expect(plan).toEqual({
      action: 'gate',
      reason:
        'Setup problem: Working directory does not exist: /Users/user/CodeProjects/LobeHub/lobehub. Create /Users/user/CodeProjects/LobeHub/lobehub on the device the agent runs on, or point the agent at a working directory that exists there',
    });
  });

  it('leaves judgment failures alone', () => {
    expect(
      planMachineRecovery({
        error: 'Task attempt budget was exhausted',
        now: FAILED_AT,
        runs: [],
        taskUpdatedAt: FAILED_AT,
      }),
    ).toEqual({ action: 'none' });
  });
});

describe('lastAnsweredGateAt', () => {
  it('returns when a person last resolved a gate opened for the node', () => {
    const graph = {
      decisions: [
        { nodeId: 'gate-1', resolvedAt: new Date('2026-10-01T00:00:00Z'), status: 'resolved' },
        { nodeId: 'gate-2', resolvedAt: new Date('2026-10-03T00:00:00Z'), status: 'resolved' },
        { nodeId: 'other', resolvedAt: new Date('2026-10-04T00:00:00Z'), status: 'resolved' },
        { nodeId: 'gate-3', resolvedAt: null, status: 'pending' },
      ],
      edges: [
        { kind: 'leads_to', sourceNodeId: 'task', targetNodeId: 'gate-1' },
        { kind: 'leads_to', sourceNodeId: 'task', targetNodeId: 'gate-2' },
        { kind: 'leads_to', sourceNodeId: 'task', targetNodeId: 'gate-3' },
      ],
    } as any;
    expect(lastAnsweredGateAt(graph, 'task')).toEqual(new Date('2026-10-03T00:00:00Z'));
    expect(lastAnsweredGateAt(graph, 'none')).toBeUndefined();
  });
});
