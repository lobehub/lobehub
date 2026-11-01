// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';
import { ProjectModel } from '../project';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acceptance-cov-user';
const topicIds = ['acceptance-cov-topic-1', 'acceptance-cov-topic-2'];

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values(topicIds.map((id) => ({ id, userId })));
});

afterEach(async () => {
  // Acceptances, projects and topics all cascade with their owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AcceptanceModel coverage', () => {
  it('keeps the recorded project while a later ensure fills a missing requirement', async () => {
    const project = await new ProjectModel(serverDB, userId).create({
      identifier: 'ACOV',
      name: 'Coverage project',
    });
    const model = new AcceptanceModel(serverDB, userId);
    const created = await model.ensureForSubject('topic', topicIds[0], { projectId: project.id });
    expect(created.requirement).toBeNull();

    const other = await new ProjectModel(serverDB, userId).create({
      identifier: 'ACOT',
      name: 'Other project',
    });
    const ensured = await model.ensureForSubject('topic', topicIds[0], {
      projectId: other.id,
      requirement: 'Ship the fix',
    });

    expect(ensured).toMatchObject({ projectId: project.id, requirement: 'Ship the fix' });
    expect(await model.findById(created.id)).toMatchObject({
      projectId: project.id,
      requirement: 'Ship the fix',
    });
  });

  it('lists without a row cap when asked for an unbounded query', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    await model.ensureForSubject('topic', topicIds[0]);
    await model.ensureForSubject('topic', topicIds[1]);

    const rows = await model.query({ limit: 1, unbounded: true });

    expect(rows.map((row) => row.subjectId).sort()).toEqual([...topicIds].sort());
  });

  it('stamps completedAt when the policy status turns terminal', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    const acceptance = await model.ensureForSubject('topic', topicIds[0]);
    expect(acceptance.completedAt).toBeNull();

    await model.updatePolicyStatus(acceptance.id, 'accepted');

    const settled = await model.findById(acceptance.id);
    expect(settled?.status).toBe('accepted');
    expect(settled?.completedAt).toBeInstanceOf(Date);

    await model.updatePolicyStatus(acceptance.id, 'pending');
    expect((await model.findById(acceptance.id))?.completedAt).toBeNull();
  });
});
