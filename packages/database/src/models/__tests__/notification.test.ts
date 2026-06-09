import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationModel } from '../../models/notification';
import { notifications } from '../../schemas/notification';
import type { LobeChatDatabase } from '../../type';

describe('NotificationModel', () => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn((_payload?: unknown) => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const db = { insert } as unknown as LobeChatDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    returning.mockResolvedValue([{ id: 'notification-1' }]);
  });

  describe('create', () => {
    it('creates user-scoped notifications without persisting workspace context', async () => {
      const model = new NotificationModel(db, 'user-1');

      await model.create({
        category: 'workspace',
        content: 'You have been removed from the workspace.',
        dedupeKey: 'member_removed_workspace-1_user-1',
        title: 'Removed from workspace',
        type: 'workspace_member_removed',
      });

      const [payload] = values.mock.calls[0];

      expect(payload).toMatchObject({
        dedupeKey: 'member_removed_workspace-1_user-1',
        userId: 'user-1',
      });
      expect(payload).not.toHaveProperty('workspaceId');
      expect(onConflictDoNothing).toHaveBeenCalledWith({
        target: [notifications.userId, notifications.dedupeKey],
      });
    });
  });
});
