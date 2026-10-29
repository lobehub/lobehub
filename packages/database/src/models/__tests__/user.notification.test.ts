import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';

const userId = 'user-notification-test';

const serverDB: LobeChatDatabase = await getTestDB();
const userModel = new UserModel(serverDB, userId);

describe('UserModel notification settings', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  const readNotification = async () =>
    (await serverDB.query.userSettings.findFirst({ where: eq(userSettings.id, userId) }))
      ?.notification;

  it('should return an empty object when nothing is stored', async () => {
    expect(await userModel.getNotificationSetting()).toEqual({});
  });

  it('should create the settings row when none exists', async () => {
    const result = await userModel.mergeNotificationSetting({ email: { enabled: false } });

    expect(result).toEqual({ email: { enabled: false } });
    expect(await readNotification()).toEqual({ email: { enabled: false } });
  });

  it('should keep sibling channels, type overrides and IM platforms', async () => {
    await serverDB.insert(userSettings).values({
      id: userId,
      general: { fontSize: 14 },
      notification: {
        email: { enabled: true, items: { billing: { credit_balance_low: false } } },
        im: { platforms: { slack: { enabled: true, tenantId: 'T1' } } },
        inbox: { enabled: true },
      },
    });

    await userModel.mergeNotificationSetting({
      email: { items: { billing: { subscription_renewed: false } } },
      im: { platforms: { telegram: { enabled: false } } },
    });

    expect(await readNotification()).toEqual({
      email: {
        enabled: true,
        items: { billing: { credit_balance_low: false, subscription_renewed: false } },
      },
      im: {
        platforms: { slack: { enabled: true, tenantId: 'T1' }, telegram: { enabled: false } },
      },
      inbox: { enabled: true },
    });
    expect(await userModel.getUserSettings()).toMatchObject({ general: { fontSize: 14 } });
  });
});
