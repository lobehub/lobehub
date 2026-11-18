// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-latest-user';
const otherUserId = 'agent-operation-latest-other';
const agentId = 'agt-latest-cook';
const otherAgentId = 'agt-latest-other';
const model = new AgentOperationModel(serverDB, userId);
const since = new Date('2026-11-10T00:00:00Z');

const run = (
  id: string,
  at: string,
  patch: Partial<typeof agentOperations.$inferInsert> = {},
): typeof agentOperations.$inferInsert => ({
  agentId,
  createdAt: new Date(at),
  id,
  status: 'done',
  userId,
  ...patch,
});

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId },
  ]);
});

afterEach(async () => {
  await serverDB
    .delete(agentOperations)
    .where(inArray(agentOperations.userId, [userId, otherUserId]));
  await serverDB.delete(agents).where(eq(agents.userId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('AgentOperationModel.findLatestSettledByAgent', () => {
  it('returns this user’s newest done or failed run of the Agent', async () => {
    await serverDB.insert(agentOperations).values([
      run('op-old-done', '2026-11-17T01:00:00Z'),
      run('op-refused', '2026-11-18T04:00:00Z', {
        error: { message: "You've hit your 5-hour limit", type: 'AgentRuntimeError' },
        status: 'error',
      }),
      // Stopped, abandoned or still going: none says whether the Agent can run now.
      run('op-stopped', '2026-11-18T04:10:00Z', { status: 'interrupted' }),
      run('op-abandoned', '2026-11-18T04:20:00Z', { status: 'abandoned' }),
      run('op-running', '2026-11-18T04:30:00Z', { status: 'running' }),
      // Another Agent, or another person's run of this one.
      run('op-other-agent', '2026-11-18T04:40:00Z', { agentId: otherAgentId }),
      run('op-other-user', '2026-11-18T04:40:00Z', { userId: otherUserId }),
    ]);

    expect(await model.findLatestSettledByAgent(agentId, since)).toMatchObject({
      error: { message: "You've hit your 5-hour limit" },
      id: 'op-refused',
      status: 'error',
    });
  });

  it('looks no further back than asked', async () => {
    await serverDB
      .insert(agentOperations)
      .values(run('op-before', '2026-11-01T00:00:00Z', { status: 'error' }));

    expect(await model.findLatestSettledByAgent(agentId, since)).toBeNull();
  });
});
