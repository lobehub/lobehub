// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, topics, users, workspaces } from '../../schemas';
import { AgentOperationModel } from '../agentOperation';

const db = await getTestDB();
const owner = 'stop-query-owner';
const member = 'stop-query-member';
const workspace = 'stop-query-workspace';

beforeAll(async () => {
  await db.insert(users).values([{ id: owner }, { id: member }]);
  await db
    .insert(workspaces)
    .values({ id: workspace, name: 'Stop query test', slug: workspace, primaryOwnerId: owner });
  await db.insert(topics).values([
    { id: 'stop-personal', userId: owner },
    { id: 'stop-team', userId: member, workspaceId: workspace },
  ]);
});
afterAll(async () => {
  const { eq, inArray } = await import('drizzle-orm');
  await db.delete(agentOperations).where(inArray(agentOperations.userId, [owner, member]));
  await db.delete(topics).where(inArray(topics.id, ['stop-personal', 'stop-team']));
  await db.delete(workspaces).where(eq(workspaces.id, workspace));
  await db.delete(users).where(inArray(users.id, [owner, member]));
});

describe('durable live operations for stopping a topic', () => {
  it('finds all live states without a topic rendering marker and excludes terminal or foreign rows', async () => {
    const personal = new AgentOperationModel(db, owner);
    const team = new AgentOperationModel(db, member, workspace);
    const states = [
      'running',
      'waiting_for_human',
      'waiting_for_async_tool',
      'waiting_for_client',
      'done',
    ] as const;
    await db.insert(agentOperations).values(
      states.map((status) => ({
        id: `stop-personal-${status}`,
        status,
        topicId: 'stop-personal',
        userId: owner,
      })),
    );
    await team.recordStart({ operationId: 'stop-team-live', topicId: 'stop-team' });
    expect((await personal.findLiveByTopic('stop-personal')).map((op) => op.status).sort()).toEqual(
      states.filter((status) => status !== 'done').sort(),
    );
    expect(await new AgentOperationModel(db, member).findLiveByTopic('stop-personal')).toEqual([]);
    expect(await personal.findLiveByTopic('stop-team')).toEqual([]);
    expect(
      (await new AgentOperationModel(db, owner, workspace).findLiveByTopic('stop-team')).map(
        (op) => op.userId,
      ),
    ).toEqual([member]);
  });
});
