import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';

const userId = 'user-system-agent-test';

const serverDB: LobeChatDatabase = await getTestDB();
const userModel = new UserModel(serverDB, userId);

describe('UserModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('mergeSystemAgentItemSetting', () => {
    const readSystemAgent = async () =>
      (
        await serverDB.query.userSettings.findFirst({
          where: eq(userSettings.id, userId),
        })
      )?.systemAgent;

    it('should create the settings row when none exists', async () => {
      await userModel.mergeSystemAgentItemSetting('followUpAction', { enabled: false });

      expect(await readSystemAgent()).toEqual({ followUpAction: { enabled: false } });
    });

    it('should merge into one entry, preserving its other fields and sibling entries', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        systemAgent: {
          followUpAction: { enabled: true, model: 'gpt-4o-mini', provider: 'openai' },
          topic: { model: 'claude', provider: 'anthropic' },
        },
      });

      await userModel.mergeSystemAgentItemSetting('followUpAction', { enabled: false });
      await userModel.mergeSystemAgentItemSetting('inputCompletion', {
        model: 'qwen',
        provider: 'qwen',
      });

      expect(await readSystemAgent()).toEqual({
        followUpAction: { enabled: false, model: 'gpt-4o-mini', provider: 'openai' },
        inputCompletion: { model: 'qwen', provider: 'qwen' },
        topic: { model: 'claude', provider: 'anthropic' },
      });
    });

    it('should replace a legacy scalar stored under the same key', async () => {
      await serverDB.insert(userSettings).values({
        id: userId,
        systemAgent: { followUpAction: 'legacy' },
      });

      await userModel.mergeSystemAgentItemSetting('followUpAction', { enabled: true });

      expect(await readSystemAgent()).toEqual({ followUpAction: { enabled: true } });
    });
  });
});
