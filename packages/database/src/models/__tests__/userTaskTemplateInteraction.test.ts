// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, userTaskTemplateInteractions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserTaskTemplateInteractionModel } from '../userTaskTemplateInteraction';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-template-interaction-test-user';
const otherUserId = 'task-template-interaction-test-user-other';

const findRow = async (uid: string, templateId: string) =>
  serverDB.query.userTaskTemplateInteractions.findFirst({
    where: and(
      eq(userTaskTemplateInteractions.userId, uid),
      eq(userTaskTemplateInteractions.templateId, templateId),
    ),
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('UserTaskTemplateInteractionModel', () => {
  describe('recordCreated', () => {
    it('writes firstCreatedAt on first call', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.recordCreated('daily-topic-pick');

      const row = await findRow(userId, 'daily-topic-pick');
      expect(row).toBeDefined();
      expect(row!.firstCreatedAt).toBeInstanceOf(Date);
      expect(row!.dismissedAt).toBeNull();
    });

    it('preserves firstCreatedAt on repeated calls (sticky)', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.recordCreated('daily-topic-pick');
      const first = await findRow(userId, 'daily-topic-pick');
      const initialFirstCreatedAt = first!.firstCreatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await model.recordCreated('daily-topic-pick');
      const second = await findRow(userId, 'daily-topic-pick');

      expect(second!.firstCreatedAt?.getTime()).toBe(initialFirstCreatedAt!.getTime());
    });
  });

  describe('dismiss', () => {
    it('writes dismissedAt on first call', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.dismiss('daily-topic-pick');

      const row = await findRow(userId, 'daily-topic-pick');
      expect(row).toBeDefined();
      expect(row!.dismissedAt).toBeInstanceOf(Date);
      expect(row!.firstCreatedAt).toBeNull();
    });

    it('refreshes dismissedAt to the latest dismissal time', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.dismiss('daily-topic-pick');
      const first = await findRow(userId, 'daily-topic-pick');

      await new Promise((r) => setTimeout(r, 10));
      await model.dismiss('daily-topic-pick');
      const second = await findRow(userId, 'daily-topic-pick');

      expect(second!.dismissedAt!.getTime()).toBeGreaterThan(first!.dismissedAt!.getTime());
    });
  });

  describe('mixed states', () => {
    it('keeps both flags when user creates then dismisses the same template', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.recordCreated('daily-topic-pick');
      await model.dismiss('daily-topic-pick');

      const row = await findRow(userId, 'daily-topic-pick');
      expect(row!.firstCreatedAt).toBeInstanceOf(Date);
      expect(row!.dismissedAt).toBeInstanceOf(Date);
    });

    it('keeps both flags when user dismisses then creates the same template', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.dismiss('daily-topic-pick');
      await model.recordCreated('daily-topic-pick');

      const row = await findRow(userId, 'daily-topic-pick');
      expect(row!.firstCreatedAt).toBeInstanceOf(Date);
      expect(row!.dismissedAt).toBeInstanceOf(Date);
    });
  });

  describe('listExcludedTemplateIds', () => {
    it('returns templates that were created or dismissed', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.recordCreated('daily-topic-pick');
      await model.dismiss('oss-intel-daily');

      const ids = await model.listExcludedTemplateIds();
      expect(ids.sort()).toEqual(['daily-topic-pick', 'oss-intel-daily']);
    });

    it('returns empty array when user has no interactions', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      const ids = await model.listExcludedTemplateIds();
      expect(ids).toEqual([]);
    });

    it('isolates results per user', async () => {
      const userModel = new UserTaskTemplateInteractionModel(serverDB, userId);
      const otherModel = new UserTaskTemplateInteractionModel(serverDB, otherUserId);
      await userModel.recordCreated('daily-topic-pick');
      await otherModel.recordCreated('oss-intel-daily');

      expect(await userModel.listExcludedTemplateIds()).toEqual(['daily-topic-pick']);
      expect(await otherModel.listExcludedTemplateIds()).toEqual(['oss-intel-daily']);
    });
  });

  describe('cascade delete', () => {
    it('removes interaction rows when the user is deleted', async () => {
      const model = new UserTaskTemplateInteractionModel(serverDB, userId);
      await model.recordCreated('daily-topic-pick');

      await serverDB.delete(users).where(eq(users.id, userId));

      const row = await findRow(userId, 'daily-topic-pick');
      expect(row).toBeUndefined();
    });
  });
});
