// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { userNewApiAccounts, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { NewApiAccountModel } from '../newapiAccount';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'newapi-account-user';
const otherUserId = 'newapi-account-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('NewApiAccountModel', () => {
  it('marks provisioning as pending', async () => {
    const model = new NewApiAccountModel(serverDB, userId);

    await model.markPending();

    const account = await model.find();
    expect(account).toMatchObject({
      lastProvisionError: null,
      status: 'pending',
      userId,
    });
  });

  it('marks provisioning as active with the NewAPI user id', async () => {
    const model = new NewApiAccountModel(serverDB, userId);

    await model.markPending();
    await model.markActive('newapi-user-1');

    const account = await model.find();
    expect(account).toMatchObject({
      lastProvisionError: null,
      newapiUserId: 'newapi-user-1',
      status: 'active',
      userId,
    });
    expect(account?.lastProvisionedAt).toBeInstanceOf(Date);
  });

  it('marks provisioning failures', async () => {
    const model = new NewApiAccountModel(serverDB, userId);

    await model.markFailed('network error');

    const account = await model.find();
    expect(account).toMatchObject({
      lastProvisionError: 'network error',
      status: 'failed',
      userId,
    });
  });

  it('only reads the account for the current user', async () => {
    await new NewApiAccountModel(serverDB, otherUserId).markActive('newapi-other-user');

    const account = await new NewApiAccountModel(serverDB, userId).find();
    const allRows = await serverDB.query.userNewApiAccounts.findMany({
      where: eq(userNewApiAccounts.userId, otherUserId),
    });

    expect(account).toBeUndefined();
    expect(allRows).toHaveLength(1);
  });
});
