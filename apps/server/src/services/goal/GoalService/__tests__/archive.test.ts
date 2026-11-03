// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { GoalArchiveModel } from '@/database/models/goalArchive';
import type { LobeChatDatabase } from '@/database/type';

import { GoalStartService } from '../../start';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-archive-service-user';

registerGoalServiceTestCleanup(serverDB, userId);

const archived = { code: 'PRECONDITION_FAILED', message: expect.stringContaining('archived') };

describe('archived goals stay put', () => {
  it('refuses to resume or restart an archived goal until it is restored', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Put away' });
    await service.close(graph.goal.id, 'achieved');
    const archive = new GoalArchiveModel(serverDB, userId);
    expect(await archive.archive(graph.goal.id)).not.toBeNull();

    await expect(service.resume(graph.goal.id)).rejects.toMatchObject(archived);
    await expect(service.restart(graph.goal.id)).rejects.toMatchObject(archived);
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe(
      'achieved',
    );

    await archive.unarchive(graph.goal.id);
    expect((await service.resume(graph.goal.id)).status).toBe('running');
  });

  it('refuses to start an archived draft', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Seed'], title: 'Draft' });
    await new GoalModel(serverDB, userId).update(graph.goal.id, { status: 'draft' });
    await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id);

    await expect(new GoalStartService(serverDB, userId).start(graph.goal.id)).rejects.toMatchObject(
      archived,
    );
    expect((await new GoalModel(serverDB, userId).findById(graph.goal.id))?.status).toBe('draft');
  });

  it('does not archive a goal that is still running', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Busy'], title: 'Live' });
    await service.tick(graph.goal.id);

    expect(await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id)).toBeNull();
  });
});
