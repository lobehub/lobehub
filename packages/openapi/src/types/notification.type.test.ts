import { describe, expect, it } from 'vitest';

import {
  NotificationAcknowledgementSchema,
  NotificationCategoryCountSchema,
  NotificationSchema,
  NotificationSettingsResponseSchema,
} from './notification.type';

// A JSON round trip on purpose: `structuredClone` would keep the Dates the wire turns into strings.
// eslint-disable-next-line unicorn/prefer-structured-clone
const wire = <T>(value: T) => JSON.parse(JSON.stringify(value));
const now = new Date('2026-11-17T08:00:00.000Z');

describe('notification response schemas', () => {
  it('accepts an inbox row with its actor snapshot', () => {
    const row = {
      actionUrl: '/tasks/T-1',
      category: 'task',
      content: 'T-1 finished',
      context: null,
      createdAt: now,
      dedupeKey: null,
      id: 'ntf-1',
      isArchived: false,
      isRead: false,
      metadata: { agent: { id: 'agt-1', name: 'Lobe' } },
      title: 'Task finished',
      type: 'task_completed',
      updatedAt: now,
      userId: 'user-1',
      workspaceId: null,
    };

    expect(() => NotificationSchema.parse(wire(row))).not.toThrow();
  });

  it('accepts category counts, settings and the data-less acknowledgement', () => {
    expect(() =>
      NotificationCategoryCountSchema.parse({
        category: 'pending',
        readCount: 0,
        totalCount: 2,
        unreadCount: 2,
      }),
    ).not.toThrow();
    expect(() =>
      NotificationSettingsResponseSchema.parse({ email: { enabled: false } }),
    ).not.toThrow();
    expect(() =>
      NotificationAcknowledgementSchema.parse({
        message: 'Notification archived',
        success: true,
        timestamp: now.toISOString(),
      }),
    ).not.toThrow();
  });
});
