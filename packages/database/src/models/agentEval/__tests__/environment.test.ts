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

  it('updates a name without touching the stored configuration', async () => {
    const created = await environmentModel.create({
      config: { envPrompt: 'keep me' },
      name: 'Before',
    });

    const updated = await environmentModel.update(created.id, { name: 'After' });

    expect(updated?.name).toBe('After');
    expect(updated?.config).toEqual({ envPrompt: 'keep me' });
  });

  it('keeps server-owned connections when the client resubmits the persona form', async () => {
    const created = await environmentModel.create({
      config: {
        agent: { systemRole: 'Persona' },
        connections: { github: { url: 'https://mock.example.com/github' } },
      },
      name: 'Shared',
    });

    const updated = await environmentModel.update(created.id, {
      config: { agent: { systemRole: 'Updated persona' } },
    });

    expect(updated?.config).toEqual({
      agent: { systemRole: 'Updated persona' },
      connections: { github: { url: 'https://mock.example.com/github' } },
    });
  });

  describe('findByIds', () => {
    it('returns nothing for an empty list', async () => {
      expect(await environmentModel.findByIds([])).toEqual([]);
    });

    it('resolves each environment once and skips unknown ids', async () => {
      const [first, second] = await serverDB
        .insert(agentEvalEnvironments)
        .values([
          { config: {}, identifier: 'env-a', name: 'A', userId },
          { config: {}, identifier: 'env-b', name: 'B', userId },
        ])
        .returning();

      const rows = await environmentModel.findByIds([
        first.id,
        second.id,
        first.id,
        '00000000-0000-4000-8000-000000000000',
      ]);

      expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    });
  });
});
