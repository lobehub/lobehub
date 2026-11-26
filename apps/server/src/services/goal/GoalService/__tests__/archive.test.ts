// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AcceptanceModel } from '@/database/models/acceptance';
import { GoalModel } from '@/database/models/goal';
import { GoalArchiveModel } from '@/database/models/goalArchive';
import { goals } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from '../../../verify/acceptanceService';
import { GoalStartService } from '../../start';
import { registerGoalServiceTestCleanup } from '../../testUtils';
import { GoalService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'goal-archive-service-user';

registerGoalServiceTestCleanup(serverDB, userId);

const archived = { code: 'PRECONDITION_FAILED', message: expect.stringContaining('archived') };

describe('archived goals stay put', () => {
  it('refuses to resume, restart, pause or close an archived goal until it is restored', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Put away' });
    await service.close(graph.goal.id, 'canceled');
    const archive = new GoalArchiveModel(serverDB, userId);
    expect(await archive.archive(graph.goal.id)).not.toBeNull();

    await expect(service.resume(graph.goal.id)).rejects.toMatchObject(archived);
    await expect(service.restart(graph.goal.id)).rejects.toMatchObject(archived);
    await expect(service.pause(graph.goal.id)).rejects.toMatchObject(archived);
    // Nor marked achieved: an archived canceled goal was never signed off.
    await expect(service.close(graph.goal.id, 'achieved')).rejects.toMatchObject(archived);
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

  // Marking a goal completed by hand leaves no Goal-level acceptance to sign
  // off, so archiving it cannot wait on one.
  it('archives a goal marked completed by hand, with nothing to sign off', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Marked completed' });
    await service.close(graph.goal.id, 'achieved');

    expect(
      (await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id))?.archivedAt,
    ).toBeInstanceOf(Date);
  });

  it('refuses a change request on a Task of an archived goal until it is restored', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Only'], title: 'Put away' });
    const { taskId } = await service.tick(graph.goal.id);
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('task', taskId!);
    await acceptanceModel.updateStatus(acceptance.id, 'delivered');
    await service.close(graph.goal.id, 'canceled');
    expect(await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id)).not.toBeNull();

    await expect(
      new AcceptanceService(serverDB, userId).reject(acceptance.id, 'Redo it'),
    ).rejects.toMatchObject(archived);
    expect((await acceptanceModel.findById(acceptance.id))?.status).toBe('delivered');
  });

  it('does not archive a goal that is still running', async () => {
    const service = new GoalService(serverDB, userId);
    const graph = await service.create({ tasks: ['Busy'], title: 'Live' });
    await service.tick(graph.goal.id);

    expect(await new GoalArchiveModel(serverDB, userId).archive(graph.goal.id)).toBeNull();
  });
});
