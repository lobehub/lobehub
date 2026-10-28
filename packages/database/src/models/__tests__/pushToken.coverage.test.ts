// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { PushLiveActivityModel } from '../pushToken';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-push-cov-user';
const liveActivityModel = new PushLiveActivityModel(serverDB, userId);

const registerDevice = (deviceId: string) =>
  liveActivityModel.upsert({
    activityId: `native-${deviceId}`,
    activityKey: 't863-activity',
    apnsEnvironment: 'sandbox',
    deviceId,
    operationId: 't863-operation',
    pushToken: `live-token-${deviceId}`,
  });

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Live-activity registrations cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('PushLiveActivityModel coverage', () => {
  it('unregisters only the named device when a device id is given', async () => {
    await registerDevice('device-a');
    await registerDevice('device-b');

    await liveActivityModel.unregister('t863-activity', 'device-a');

    const remaining = await liveActivityModel.listByActivityKey('t863-activity');
    expect(remaining.map((row) => row.deviceId)).toEqual(['device-b']);
  });
});
