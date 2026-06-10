// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyCriteria, verifyRubricCriteria, verifyRubrics } from '../../schemas';
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
  await serverDB.delete(verifyRubricCriteria);
  await serverDB.delete(verifyCriteria);
  await serverDB.delete(verifyRubrics);
  await serverDB.delete(users);
});

const insertCriterion = async (ownerId: string, title: string) => {
  const [row] = await serverDB
    .insert(verifyCriteria)
    .values({ title, userId: ownerId, verifierType: 'llm' })
    .returning();
  return row;
};

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

describe('VerifyRubricModel query / delete', () => {
  it('lists rubrics for the owning user ordered by updatedAt desc', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const first = await model.create({ title: 'first' });
    const second = await model.create({ title: 'second' });

    // Set explicit, well-separated timestamps so `query` ordering (desc updatedAt)
    // is deterministic — relying on create/update timing can tie within the same ms.
    await serverDB
      .update(verifyRubrics)
      .set({ updatedAt: new Date('2025-01-02T00:00:00Z') })
      .where(eq(verifyRubrics.id, first.id));
    await serverDB
      .update(verifyRubrics)
      .set({ updatedAt: new Date('2025-01-01T00:00:00Z') })
      .where(eq(verifyRubrics.id, second.id));

    const list = await model.query();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(first.id);
    expect(list[1].id).toBe(second.id);
  });

  it('does not list rubrics owned by another user', async () => {
    await new VerifyRubricModel(serverDB, userId).create({ title: 'mine' });
    await new VerifyRubricModel(serverDB, otherUserId).create({ title: 'theirs' });

    const list = await new VerifyRubricModel(serverDB, userId).query();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('mine');
  });

  it('deletes a rubric owned by the user', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const created = await model.create({ title: 'to-delete' });

    await model.delete(created.id);

    const found = await model.findById(created.id);
    expect(found).toBeUndefined();
  });

  it('does not delete a rubric owned by another user', async () => {
    const created = await new VerifyRubricModel(serverDB, userId).create({ title: 'mine' });

    await new VerifyRubricModel(serverDB, otherUserId).delete(created.id);

    const found = await new VerifyRubricModel(serverDB, userId).findById(created.id);
    expect(found?.id).toBe(created.id);
  });

  it('cascades junction rows when the rubric is deleted', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'with-criteria' });
    const c1 = await insertCriterion(userId, 'c1');
    await model.setCriteria(rubric.id, [{ criterionId: c1.id }]);

    await model.delete(rubric.id);

    const links = await serverDB.query.verifyRubricCriteria.findMany({
      where: eq(verifyRubricCriteria.rubricId, rubric.id),
    });
    expect(links).toHaveLength(0);
  });
});

describe('VerifyRubricModel getCriteria / setCriteria', () => {
  it('returns an empty array when the rubric has no criteria', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'empty' });

    const result = await model.getCriteria(rubric.id);
    expect(result).toEqual([]);
  });

  it('attaches criteria and resolves them ordered by sortOrder', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'ordered' });
    const a = await insertCriterion(userId, 'a');
    const b = await insertCriterion(userId, 'b');
    const c = await insertCriterion(userId, 'c');

    await model.setCriteria(rubric.id, [
      { criterionId: b.id, sortOrder: 2 },
      { criterionId: a.id, sortOrder: 0 },
      { criterionId: c.id, sortOrder: 1 },
    ]);

    const resolved = await model.getCriteria(rubric.id);
    expect(resolved.map((r) => r.title)).toEqual(['a', 'c', 'b']);
  });

  it('defaults sortOrder to the array index when omitted', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'default-order' });
    const a = await insertCriterion(userId, 'a');
    const b = await insertCriterion(userId, 'b');

    await model.setCriteria(rubric.id, [{ criterionId: a.id }, { criterionId: b.id }]);

    const resolved = await model.getCriteria(rubric.id);
    expect(resolved.map((r) => r.title)).toEqual(['a', 'b']);
  });

  it('replaces existing criteria idempotently', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'replace' });
    const a = await insertCriterion(userId, 'a');
    const b = await insertCriterion(userId, 'b');

    await model.setCriteria(rubric.id, [{ criterionId: a.id }]);
    await model.setCriteria(rubric.id, [{ criterionId: b.id }]);

    const resolved = await model.getCriteria(rubric.id);
    expect(resolved.map((r) => r.title)).toEqual(['b']);
  });

  it('clears all criteria when given an empty set', async () => {
    const model = new VerifyRubricModel(serverDB, userId);
    const rubric = await model.create({ title: 'clear' });
    const a = await insertCriterion(userId, 'a');

    await model.setCriteria(rubric.id, [{ criterionId: a.id }]);
    await model.setCriteria(rubric.id, []);

    const resolved = await model.getCriteria(rubric.id);
    expect(resolved).toEqual([]);
  });

  it('scopes getCriteria to the owning user', async () => {
    const owner = new VerifyRubricModel(serverDB, userId);
    const rubric = await owner.create({ title: 'scoped' });
    const a = await insertCriterion(userId, 'a');
    await owner.setCriteria(rubric.id, [{ criterionId: a.id }]);

    const asOther = await new VerifyRubricModel(serverDB, otherUserId).getCriteria(rubric.id);
    expect(asOther).toEqual([]);
  });

  it('setCriteria from another user does not remove the owner junction rows', async () => {
    const owner = new VerifyRubricModel(serverDB, userId);
    const rubric = await owner.create({ title: 'isolation' });
    const a = await insertCriterion(userId, 'a');
    await owner.setCriteria(rubric.id, [{ criterionId: a.id }]);

    // other user clears with an empty set — userId-scoped delete leaves owner rows intact
    await new VerifyRubricModel(serverDB, otherUserId).setCriteria(rubric.id, []);

    const resolved = await owner.getCriteria(rubric.id);
    expect(resolved.map((r) => r.title)).toEqual(['a']);
  });
});
