// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import { acceptances, verifyRuns } from '../../schemas/verify';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-dependency-verdict-user';

/**
 * Regression (T-11863): the unlock read only `tasks.status`, so a dependency
 * that reached `completed` on a delivery the verifier rejected still started
 * its dependents. A completed dependency now blocks until its latest verify
 * round passes or a person accepts the delivery.
 */
describe('TaskModel dependency unlock × verify verdict', () => {
  let model: TaskModel;

  beforeEach(async () => {
    await serverDB.delete(users).where(eq(users.id, userId));
    await serverDB.insert(users).values({ id: userId });
    model = new TaskModel(serverDB, userId);
  });

  afterEach(async () => {
    await serverDB.delete(users).where(eq(users.id, userId));
  });

  /** Parent A with dependent B; A completed, its Acceptance carrying the given rounds. */
  const setup = async (
    rounds: ('errored' | 'failed' | 'passed')[],
    acceptanceStatus: 'accepted' | 'delivered' = 'delivered',
  ) => {
    const parent = await model.create({ instruction: 'Parent A' });
    const dependent = await model.create({ instruction: 'Dependent B' });
    await model.addDependency(dependent.id, parent.id);

    if (rounds.length > 0) {
      const [acceptance] = await serverDB
        .insert(acceptances)
        .values({ status: acceptanceStatus, subjectId: parent.id, subjectType: 'task', userId })
        .returning();
      await serverDB.insert(verifyRuns).values(
        rounds.map((status, index) => ({
          acceptanceId: acceptance.id,
          roundIndex: index + 1,
          status,
          userId,
        })),
      );
    }

    await model.updateStatus(parent.id, 'completed');
    return { dependent, parent };
  };

  it('keeps the dependent locked when the latest verify round failed', async () => {
    const { dependent, parent } = await setup(['failed']);

    expect(await model.getUnlockedTasks(parent.id)).toHaveLength(0);
    expect(await model.areAllDependenciesCompleted(dependent.id)).toBe(false);
  });

  it('keeps the dependent locked when the latest verify round errored', async () => {
    const { parent } = await setup(['errored']);

    expect(await model.getUnlockedTasks(parent.id)).toHaveLength(0);
  });

  it('unlocks the dependent when the latest verify round passed', async () => {
    const { dependent, parent } = await setup(['failed', 'passed']);

    const unlocked = await model.getUnlockedTasks(parent.id);
    expect(unlocked.map((task) => task.id)).toEqual([dependent.id]);
    expect(await model.areAllDependenciesCompleted(dependent.id)).toBe(true);
  });

  it('judges the latest round, not an earlier pass', async () => {
    const { parent } = await setup(['passed', 'failed']);

    expect(await model.getUnlockedTasks(parent.id)).toHaveLength(0);
  });

  it('unlocks the dependent once a person accepts the failed delivery', async () => {
    const { dependent, parent } = await setup(['failed'], 'accepted');

    const unlocked = await model.getUnlockedTasks(parent.id);
    expect(unlocked.map((task) => task.id)).toEqual([dependent.id]);
  });

  it('unlocks the dependent of a task without verification as before', async () => {
    const { dependent, parent } = await setup([]);

    const unlocked = await model.getUnlockedTasks(parent.id);
    expect(unlocked.map((task) => task.id)).toEqual([dependent.id]);
  });

  it('still blocks the batched unlock when one of two completed dependencies was rejected', async () => {
    const { dependent, parent } = await setup(['failed']);
    const other = await model.create({ instruction: 'Parent C' });
    await model.addDependency(dependent.id, other.id);
    await model.updateStatus(other.id, 'completed');

    expect(await model.getUnlockedTasksForMany([parent.id, other.id])).toHaveLength(0);
  });
});
