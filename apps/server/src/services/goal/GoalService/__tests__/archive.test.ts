// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalArchiveModel } from '@/database/models/goalArchive';
import { goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { GoalStartService } from '../../start';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-archive-service-user';

registerGoalServiceTestCleanup(serverDB, userId);

const archived = { code: 'PRECONDITION_FAILED', message: expect.stringContaining('archived') };

describe('archived goals stay put', () => {
  it('refuses to resume, restart or pause an archived goal until it is restored', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Put away' });
    await service.close(graph.goal.id, 'canceled');
    const archive = new GoalArchiveModel(serverDB, userId);
    expect(await archive.archive(graph.goal.id)).not.toBeNull();

    await expect(service.resume(graph.goal.id)).rejects.toMatchObject(archived);
    await expect(service.restart(graph.goal.id)).rejects.toMatchObject(archived);
    await expect(service.pause(graph.goal.id)).rejects.toMatchObject(archived);
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'canceled',
    );

    await archive.unarchive(graph.goal.id);
    expect((await service.resume(graph.goal.id)).status).toBe('running');
  });

  it('refuses to start a draft that carries an archive mark', async () => {
    // Drafts cannot be archived; the start guard still holds if one ever is.
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Seed'], title: 'Draft' });
    await new GoalModel(serverDB, userId).update(graph.goal.id, { status: 'draft' });
    await serverDB.update(goals).set({ archivedAt: new Date() }).where(eq(goals.id, graph.goal.id));

    await expect(new GoalStartService(serverDB, userId).start(graph.goal.id)).rejects.toMatchObject(
      archived,
    );
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('draft');
  });

  it('does not archive an achieved goal before its owner signs it off', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Awaiting sign-off' });
    await service.close(graph.goal.id, 'achieved');

    expect(await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id)).toBeNull();
  });

  it('does not archive a goal that is still running', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Busy'], title: 'Live' });
    await service.tick(graph.goal.id);

    expect(await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id)).toBeNull();
  });
});
