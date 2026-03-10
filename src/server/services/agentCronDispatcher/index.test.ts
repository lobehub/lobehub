// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { type AgentCronJob } from '@/database/schemas/agentCronJob';

import {
  evaluateCronJobDue,
  matchesCronPattern,
  resolveCronEvalContext,
  type TimeParts,
} from './index';

const createJob = (overrides: Partial<AgentCronJob> = {}): AgentCronJob => {
  return {
    accessedAt: new Date('2026-02-26T00:00:00.000Z'),
    agentId: 'agent_1',
    content: 'heartbeat',
    createdAt: new Date('2026-02-26T00:00:00.000Z'),
    cronPattern: '*/30 * * * *',
    description: null,
    editData: null,
    enabled: true,
    executionConditions: null,
    groupId: null,
    id: 'cron_1',
    lastExecutedAt: null,
    maxExecutions: null,
    name: 'Heartbeat',
    remainingExecutions: null,
    timezone: 'UTC',
    totalExecutions: 0,
    updatedAt: new Date('2026-02-26T00:00:00.000Z'),
    userId: 'user_1',
    ...overrides,
  };
};

describe('agentCronDispatcher helpers', () => {
  it('should match basic cron pattern', () => {
    const parts: TimeParts = {
      day: 27,
      hour: 10,
      minute: 30,
      month: 2,
      slotId: '202602271030',
      weekday: 5,
      year: 2026,
    };

    expect(matchesCronPattern('*/30 * * * *', parts)).toBe(true);
    expect(matchesCronPattern('15 * * * *', parts)).toBe(false);
    expect(matchesCronPattern('30 10 * * 5', parts)).toBe(true);
  });

  it('should evaluate due job with timezone', () => {
    const now = new Date('2026-02-27T00:30:00.000Z');

    const result = evaluateCronJobDue(
      createJob({
        cronPattern: '30 8 * * *',
        timezone: 'Asia/Shanghai',
      }),
      now,
    );

    expect(result.due).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should skip if already executed in current slot', () => {
    const now = new Date('2026-02-27T00:30:00.000Z');

    const result = evaluateCronJobDue(
      createJob({
        cronPattern: '30 8 * * *',
        lastExecutedAt: new Date('2026-02-27T00:30:10.000Z'),
        timezone: 'Asia/Shanghai',
      }),
      now,
    );

    expect(result.due).toBe(false);
    expect(result.reason).toBe('already_executed_this_slot');
  });

  it('should respect execution conditions for weekdays and time range', () => {
    const now = new Date('2026-02-27T00:30:00.000Z'); // Friday 08:30 in Asia/Shanghai

    const dueResult = evaluateCronJobDue(
      createJob({
        cronPattern: '30 8 * * *',
        executionConditions: {
          timeRange: { end: '09:00', start: '08:00' },
          weekdays: [1, 2, 3, 4, 5],
        },
        timezone: 'Asia/Shanghai',
      }),
      now,
    );

    const notDueResult = evaluateCronJobDue(
      createJob({
        cronPattern: '30 8 * * *',
        executionConditions: {
          timeRange: { end: '09:00', start: '08:00' },
          weekdays: [1, 2, 3, 4],
        },
        timezone: 'Asia/Shanghai',
      }),
      now,
    );

    expect(dueResult.due).toBe(true);
    expect(notDueResult.due).toBe(false);
    expect(notDueResult.reason).toBe('weekday_not_allowed');
  });

  it('should derive eval context directives from curated skill markers', () => {
    const context = resolveCronEvalContext(
      createJob({
        content: [
          'Heartbeat run.',
          'Use curated skill: moltbook.',
          'Call runSkill(name="moltbook") directly; do not call searchSkill.',
          'Use Cloud Sandbox HTTP path only (lobe-cloud-sandbox runCommand + curl).',
        ].join('\n'),
      }),
    );

    expect(context?.envPrompt).toContain('runSkill(name="moltbook") directly');
    expect(context?.envPrompt).toContain('Do not call searchSkill');
    expect(context?.envPrompt).toContain('identifier: lobe-cloud-sandbox');
  });

  it('should not infer hidden directives from domain-specific heartbeat wording', () => {
    const context = resolveCronEvalContext(
      createJob({
        content:
          'Run Moltbook heartbeat by calling home API: GET https://www.moltbook.com/api/v1/home and summarize results.',
      }),
    );

    expect(context).toBeUndefined();
  });

  it('should return undefined eval context when no directives are present', () => {
    const context = resolveCronEvalContext(
      createJob({
        content: 'Daily summary: collect insights and report once.',
      }),
    );

    expect(context).toBeUndefined();
  });
});
