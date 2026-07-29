import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('starts a configured cron schedule on any task without running it immediately', () => {
    expect(systemPrompt).toContain(
      'start its schedule by default with updateTaskStatus(identifier, "scheduled")',
    );
    expect(systemPrompt).toContain('on any task');
    expect(systemPrompt).toContain('Do NOT call runTask just to start the schedule');
    expect(systemPrompt).toContain(
      'Only leave it unstarted when the user explicitly asks to keep it paused or as a draft',
    );
  });
});
