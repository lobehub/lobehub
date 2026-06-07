// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyRubrics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyRubricModel } from '../verifyRubric';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-rubric-test-user';
const otherUserId = 'verify-rubric-test-other';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyRubrics);
  await serverDB.delete(users);
});

describe('VerifyRubricModel config', () => {
  it('persists run-policy config on create and reads it back', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const created = await model.create({ config: { maxRepairRounds: 3 }, title: 'standard' });

    const found = await model.findById(created.id);
    expect(found?.title).toBe('standard');
    expect(found?.config).toEqual({ maxRepairRounds: 3 });
  });

  it('defaults config to an empty object when omitted', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const created = await model.create({ title: 'no config' });

    const found = await model.findById(created.id);
    expect(found?.config).toEqual({});
  });

  it('updates the config independently of other fields', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const created = await model.create({ config: { maxRepairRounds: 1 }, title: 'standard' });

    await model.update(created.id, { config: { maxRepairRounds: 0 } });

    const found = await model.findById(created.id);
    expect(found?.config).toEqual({ maxRepairRounds: 0 });
    expect(found?.title).toBe('standard');
  });

  it('scopes reads to the owning user', async () => {
    const created = await new VerifyRubricModel(serverDB, userId).create({
      config: { maxRepairRounds: 2 },
      title: 'mine',
    });

    const asOther = await new VerifyRubricModel(serverDB, otherUserId).findById(created.id);
    expect(asOther).toBeUndefined();
  });
});
