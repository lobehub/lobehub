import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentEvalEnvironments, agentEvalTestCases, users } from '../../../schemas';
import { AgentEvalEnvironmentModel } from '../environment';

const serverDB = await getTestDB();

const userId = 'environment-test-user';
const otherUserId = 'environment-test-other-user';
const environmentModel = new AgentEvalEnvironmentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalEnvironments);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(agentEvalTestCases);
  await serverDB.delete(agentEvalEnvironments);
  await serverDB.delete(users);
});

describe('AgentEvalEnvironmentModel', () => {
  it('creates environments owned by the actor', async () => {
    const created = await environmentModel.create({
      config: { sessionDate: '2026-07-24' },
      name: 'Mine',
    });
    expect(created.userId).toBe(userId);
    expect((await environmentModel.findById(created.id))?.name).toBe('Mine');
  });

  it('reads system environments (userId null) next to its own, never another user’s', async () => {
    await serverDB.insert(agentEvalEnvironments).values([
      { config: {}, identifier: 'env-system', name: 'System', userId: null },
      { config: {}, identifier: 'env-mine', name: 'Mine', userId },
      { config: {}, identifier: 'env-theirs', name: 'Theirs', userId: otherUserId },
    ]);

    const listed = await environmentModel.query();
    expect(listed.map((e) => e.identifier).sort()).toEqual(['env-mine', 'env-system']);
    expect((await environmentModel.findByIdentifier('env-system'))?.name).toBe('System');
    expect(await environmentModel.findByIdentifier('env-theirs')).toBeUndefined();
  });

  it('never updates or deletes a system environment', async () => {
    const [system] = await serverDB
      .insert(agentEvalEnvironments)
      .values({ config: {}, identifier: 'env-system', name: 'System', userId: null })
      .returning();

    expect(await environmentModel.update(system.id, { name: 'Changed' })).toBeUndefined();
    await environmentModel.delete(system.id);

    const [still] = await serverDB
      .select()
      .from(agentEvalEnvironments)
      .where(eq(agentEvalEnvironments.id, system.id));
    expect(still.name).toBe('System');
  });
});
