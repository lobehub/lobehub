// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, verifyCriteria, verifyRubricCriteria, verifyRubrics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCriterionModel } from '../verifyCriterion';
import { VerifyRubricModel } from '../verifyRubric';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-rubric-test-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyRubricCriteria);
  await serverDB.delete(verifyRubrics);
  await serverDB.delete(verifyCriteria);
  await serverDB.delete(users);
});

describe('VerifyRubricModel', () => {
  it('creates a rubric and attaches ordered criteria', async () => {
    const criterionModel = new VerifyCriterionModel(serverDB, userId);
    const rubricModel = new VerifyRubricModel(serverDB, userId);

    const c1 = await criterionModel.create({ title: 'first', verifierType: 'llm' });
    const c2 = await criterionModel.create({ title: 'second', verifierType: 'agent' });

    const rubric = await rubricModel.create({ title: 'Delivery basics' });
    await rubricModel.setCriteria(rubric.id, [
      { criterionId: c2.id, sortOrder: 0 },
      { criterionId: c1.id, sortOrder: 1 },
    ]);

    const criteria = await rubricModel.getCriteria(rubric.id);
    expect(criteria.map((c) => c.title)).toEqual(['second', 'first']);
  });

  it('setCriteria replaces the previous set idempotently', async () => {
    const criterionModel = new VerifyCriterionModel(serverDB, userId);
    const rubricModel = new VerifyRubricModel(serverDB, userId);

    const c1 = await criterionModel.create({ title: 'a', verifierType: 'llm' });
    const c2 = await criterionModel.create({ title: 'b', verifierType: 'llm' });
    const rubric = await rubricModel.create({ title: 'r' });

    await rubricModel.setCriteria(rubric.id, [{ criterionId: c1.id }]);
    await rubricModel.setCriteria(rubric.id, [{ criterionId: c2.id }]);

    const criteria = await rubricModel.getCriteria(rubric.id);
    expect(criteria.map((c) => c.id)).toEqual([c2.id]);
  });

  it('deletes a rubric and cascades the junction rows', async () => {
    const criterionModel = new VerifyCriterionModel(serverDB, userId);
    const rubricModel = new VerifyRubricModel(serverDB, userId);

    const c1 = await criterionModel.create({ title: 'a', verifierType: 'llm' });
    const rubric = await rubricModel.create({ title: 'r' });
    await rubricModel.setCriteria(rubric.id, [{ criterionId: c1.id }]);

    await rubricModel.delete(rubric.id);
    expect(await rubricModel.findById(rubric.id)).toBeUndefined();
    expect(await rubricModel.getCriteria(rubric.id)).toEqual([]);
    // the criterion itself is independent and survives
    expect(await criterionModel.findById(c1.id)).toBeDefined();
  });
});
