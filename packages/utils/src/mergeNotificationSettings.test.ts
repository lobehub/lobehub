import { describe, expect, it } from 'vitest';

import { mergeNotificationSettings } from './mergeNotificationSettings';

describe('mergeNotificationSettings', () => {
  it('keeps sibling type switches when patching one channel leaf', () => {
    const merged = mergeNotificationSettings(
      {
        inbox: {
          items: { schedule: { agent_cron_job_completed: true, agent_cron_job_failed: false } },
        },
      },
      { inbox: { items: { schedule: { agent_cron_job_completed: false } } } },
    );

    expect(merged.inbox?.items?.schedule).toEqual({
      agent_cron_job_completed: false,
      agent_cron_job_failed: false,
    });
  });

  it('merges content switches without touching channels', () => {
    const merged = mergeNotificationSettings(
      { content: { scheduledTaskSummary: true }, inbox: { enabled: false } },
      { content: { scheduledTaskSummary: false } },
    );

    expect(merged).toEqual({
      content: { scheduledTaskSummary: false },
      inbox: { enabled: false },
    });
  });

  it('keeps content switches when a channel is patched', () => {
    const merged = mergeNotificationSettings(
      { content: { scheduledTaskSummary: false } },
      { email: { enabled: false } },
    );

    expect(merged.content).toEqual({ scheduledTaskSummary: false });
    expect(merged.email).toEqual({ enabled: false });
  });
});
