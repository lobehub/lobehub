import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('hands successful goal execution off instead of duplicating it in the origin conversation', () => {
    expect(systemPrompt).toContain('the work has been handed off to a separate task topic');
    expect(systemPrompt).toContain(
      'do not perform, reproduce, preview, or self-check the requested work in the current conversation',
    );
    expect(systemPrompt).toContain('its live card shows progress');
  });

  it('starts a configured cron schedule by default without running it immediately', () => {
    expect(systemPrompt).toContain(
      'start its schedule by default with updateTaskStatus(identifier, "scheduled")',
    );
    // Guard against re-arming running or already scheduled tasks: updateStatus
    // interrupts in-flight runs when leaving 'running', and re-entering
    // 'scheduled' resets the maxExecutions counting window.
    expect(systemPrompt).toContain('neither currently running nor already scheduled');
    expect(systemPrompt).toContain('Never call updateTaskStatus on a currently running task');
    expect(systemPrompt).toContain(
      're-calling updateTaskStatus would reset its execution-count window',
    );
    expect(systemPrompt).toContain('Do NOT call runTask just to start the schedule');
    // Draft/paused intent must be an explicit 'paused' status: the cron
    // dispatcher picks up schedule-mode tasks in any non-excluded status,
    // including 'backlog', so merely leaving the task unstarted is not enough.
    expect(systemPrompt).toContain('call updateTaskStatus(identifier, "paused") instead');
  });
});
