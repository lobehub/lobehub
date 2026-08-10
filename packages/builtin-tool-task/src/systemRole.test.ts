import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('does not instruct the task tool to run the goal workflow', () => {
    expect(systemPrompt).not.toContain('**createGoal**');
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
