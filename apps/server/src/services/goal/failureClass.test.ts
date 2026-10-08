import { describe, expect, it } from 'vitest';

import { classifyGoalFailure, parseQuotaResetAt } from './failureClass';

/**
 * Fixtures are the reasons real Goal decision gates were opened with (36 goals,
 * 35 gates). Most of them were machine problems the coordinator put up for
 * judgment; these pin which class each one lands in.
 */
describe('classifyGoalFailure', () => {
  it.each([
    "You've hit your session limit · resets 4:30am (Asia/Shanghai)",
    "You've hit your session limit · resets 2am (Asia/Hong_Kong)",
    "You've hit your session limit · resets 7:40am (Asia/Shanghai)",
    "You've hit your usage limit. Upgrade to Pro or try again at 5:00 PM (America/New_York).",
    "You've hit your weekly limit · resets Oct 9, 5pm (America/New_York)",
  ])('reads %s as a usage limit', (error) => {
    expect(classifyGoalFailure(error).class).toBe('quota');
  });

  it.each([
    '{"error":"TIMEOUT","success":false}',
    "Server discarded the agent's output (operation-not-running): this run is no longer the topic's active operation, so nothing it produced was saved",
    'Failed to persist tool_result for message msg_8ggMzr8jCOsJL51nwA',
    '{"error":"DEVICE_GATEWAY_ERROR","success":false}',
    'The device connection service hit an error while starting this run. Nothing started on the device. This is usually temporary — try again in a moment.',
    'fetch failed: ECONNRESET',
    'RateLimitExceeded',
  ])('reads %s as transient', (error) => {
    expect(classifyGoalFailure(error).class).toBe('transient');
  });

  it('reads a missing working directory as a setup problem naming the path', () => {
    expect(
      classifyGoalFailure(
        'Working directory does not exist: /Users/user/CodeProjects/LobeHub/lobehub',
      ),
    ).toEqual({
      class: 'environment',
      problem: { kind: 'workingDirectory', path: '/Users/user/CodeProjects/LobeHub/lobehub' },
    });
  });

  it.each([
    ['Claude Code CLI was not found. Install it and make sure `claude` can be executed.', 'cli'],
    [
      'The device this agent is bound to is no longer registered with the connection service. Reconnect the device, or bind this agent to another online device.',
      'device',
    ],
    [
      "The device this agent runs on is offline, so the run couldn't start. Check that the LobeHub desktop app (or the `lh` CLI) is running and connected, then try again.",
      'device',
    ],
    ['GATEWAY_NOT_CONFIGURED', 'gateway'],
    ['InvalidProviderAPIKey', 'credentials'],
  ])('reads %s as a setup problem (%s)', (error, kind) => {
    expect(classifyGoalFailure(error)).toMatchObject({ class: 'environment', problem: { kind } });
  });

  it.each([
    'Task attempt budget was exhausted',
    'Task canceled',
    'Acceptance review could not judge the delivery from evidence alone; the criterion needs a judge that can act on the system.',
    'Acceptance review could not run; the delivery passed its verifiers but was never reviewed.',
    'Delivery did not pass verification.',
    '',
  ])('leaves %s to judgment', (error) => {
    expect(classifyGoalFailure(error).class).toBe('judgment');
  });

  it('attaches the reset time a usage limit names', () => {
    const failedAt = new Date('2026-10-05T19:50:01.285Z');
    expect(
      classifyGoalFailure(
        "You've hit your session limit · resets 4:30am (Asia/Shanghai)",
        failedAt,
      ),
    ).toEqual({ class: 'quota', resetAt: new Date('2026-10-05T20:30:00.000Z') });
  });
});

describe('parseQuotaResetAt', () => {
  it('places a bare wall-clock time in its zone, on the next occurrence after the failure', () => {
    // 03:50 Shanghai → 04:30 the same morning.
    expect(
      parseQuotaResetAt(
        'resets 4:30am (Asia/Shanghai)',
        new Date('2026-10-05T19:50:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-10-05T20:30:00.000Z');
    // 05:00 Shanghai → 04:30 the next morning.
    expect(
      parseQuotaResetAt(
        'resets 4:30am (Asia/Shanghai)',
        new Date('2026-10-05T21:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-10-06T20:30:00.000Z');
    expect(
      parseQuotaResetAt(
        'resets 2am (Asia/Hong_Kong)',
        new Date('2026-10-05T12:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-10-05T18:00:00.000Z');
  });

  it('honours daylight saving in the named zone', () => {
    // New York is UTC-4 in October.
    expect(
      parseQuotaResetAt(
        "You've hit your weekly limit · resets Oct 9, 5pm (America/New_York)",
        new Date('2026-10-05T12:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2026-10-09T21:00:00.000Z');
  });

  it('reads ISO and relative reset times', () => {
    const failedAt = new Date('2026-10-05T12:00:00.000Z');
    expect(
      parseQuotaResetAt(
        'Usage limit reached; resets at 2026-10-05T17:00:00Z',
        failedAt,
      )?.toISOString(),
    ).toBe('2026-10-05T17:00:00.000Z');
    expect(
      parseQuotaResetAt(
        'Usage limit reached, try again in 2 hours 15 minutes',
        failedAt,
      )?.toISOString(),
    ).toBe('2026-10-05T14:15:00.000Z');
  });

  it('gives no reset time when it cannot place one', () => {
    const failedAt = new Date('2026-10-05T12:00:00.000Z');
    expect(parseQuotaResetAt("You've hit your session limit", failedAt)).toBeUndefined();
    expect(parseQuotaResetAt('resets 4:30am (Not/AZone)', failedAt)).toBeUndefined();
  });
});
