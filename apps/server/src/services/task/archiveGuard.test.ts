import { describe, expect, it } from 'vitest';

import { assertArchivedTaskStaysIdle } from './archiveGuard';

const archived = { archivedAt: new Date(), status: 'completed' };

describe('assertArchivedTaskStaysIdle', () => {
  it('ignores tasks that are not archived', () => {
    expect(() =>
      assertArchivedTaskStaysIdle({ status: 'backlog' }, { status: 'running' }),
    ).not.toThrow();
  });

  it('refuses to start or schedule an archived task', () => {
    expect(() => assertArchivedTaskStaysIdle(archived, { status: 'running' })).toThrow(
      expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
    );
    expect(() =>
      assertArchivedTaskStaysIdle(
        { ...archived, status: 'backlog' },
        { automationMode: 'schedule', schedulePattern: '0 9 * * *', status: 'scheduled' },
      ),
    ).toThrow(expect.objectContaining({ code: 'PRECONDITION_FAILED' }));
    expect(() =>
      assertArchivedTaskStaysIdle(
        { ...archived, status: 'backlog' },
        { automationMode: 'heartbeat', heartbeatInterval: 600 },
      ),
    ).toThrow(expect.objectContaining({ code: 'PRECONDITION_FAILED' }));
  });

  it('allows edits that keep an archived task idle', () => {
    expect(() => assertArchivedTaskStaysIdle(archived, {})).not.toThrow();
    expect(() => assertArchivedTaskStaysIdle(archived, { status: 'canceled' })).not.toThrow();
    // Removing a schedule never makes the task live.
    expect(() =>
      assertArchivedTaskStaysIdle(
        { ...archived, automationMode: 'schedule', schedulePattern: '0 9 * * *', status: 'paused' },
        { automationMode: null },
      ),
    ).not.toThrow();
  });
});
