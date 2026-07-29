import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
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
    expect(systemPrompt).toContain(
      'Only leave it unstarted when the user explicitly asks to keep it paused or as a draft',
    );
  });
});
