// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyCriteria } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCriterionModel } from '../verifyCriterion';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-criterion-test-user';
const otherUserId = 'verify-criterion-test-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyCriteria);
  await serverDB.delete(users);
});

describe('VerifyCriterionModel', () => {
  it('creates a criterion scoped to the user', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const created = await model.create({
      title: 'type-check passes',
      verifierConfig: { command: 'pnpm type-check' },
      verifierType: 'program',
    });

    expect(created).toMatchObject({
      onFail: 'manual',
      required: true,
      title: 'type-check passes',
      userId,
      verifierType: 'program',
    });
    expect(created.id).toBeDefined();
  });

  it('lists only the current user criteria', async () => {
    const mine = new VerifyCriterionModel(serverDB, userId);
    const other = new VerifyCriterionModel(serverDB, otherUserId);
    await mine.create({ title: 'a', verifierType: 'llm' });
    await other.create({ title: 'b', verifierType: 'llm' });

    const list = await mine.query();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('a');
  });

  it('resolves a set of ids via findByIds (user-scoped)', async () => {
    const mine = new VerifyCriterionModel(serverDB, userId);
    const other = new VerifyCriterionModel(serverDB, otherUserId);
    const a = await mine.create({ title: 'a', verifierType: 'llm' });
    const b = await mine.create({ title: 'b', verifierType: 'agent' });
    const leaked = await other.create({ title: 'leaked', verifierType: 'llm' });

    const resolved = await mine.findByIds([a.id, b.id, leaked.id]);
    expect(resolved.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('updates and deletes', async () => {
    const model = new VerifyCriterionModel(serverDB, userId);
    const c = await model.create({ title: 'old', verifierType: 'llm' });

    await model.update(c.id, { required: false, title: 'new' });
    expect(await model.findById(c.id)).toMatchObject({ required: false, title: 'new' });

    await model.delete(c.id);
    expect(await model.findById(c.id)).toBeUndefined();
  });
});
