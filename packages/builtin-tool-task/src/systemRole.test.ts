import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('starts a configured cron schedule by default without running it immediately', () => {
    expect(systemPrompt).toContain(
      'start its schedule by default with updateTaskStatus(identifier, "scheduled")',
    );
    // Guard against rescheduling a running task: updateStatus interrupts
    // in-flight runs when leaving the 'running' status.
    expect(systemPrompt).toContain('on a task that is not currently running');
    expect(systemPrompt).toContain('Never call updateTaskStatus on a currently running task');
    expect(systemPrompt).toContain('Do NOT call runTask just to start the schedule');
    expect(systemPrompt).toContain(
      'Only leave it unstarted when the user explicitly asks to keep it paused or as a draft',
    );
  });
});
