// @vitest-environment node
import type { AcceptanceRepairRequest } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acceptance-repair-user';
const otherUserId = 'acceptance-repair-other';

const repairRequest = (
  overrides: Partial<AcceptanceRepairRequest> = {},
): AcceptanceRepairRequest => ({
  commentIds: [],
  feedback: 'please realign the header',
  id: 'repair-request-1',
  requestedAt: '2026-10-26T00:00:00.000Z',
  requestedBy: userId,
  state: 'starting',
  ...overrides,
});

const model = new AcceptanceModel(serverDB, userId);

const seedAcceptance = async (subjectId: string, owner = userId) => {
  const [row] = await serverDB
    .insert(acceptances)
    .values({ subjectId, subjectType: 'task', userId: owner })
    .returning();
  return row;
};

beforeEach(async () => {
  await serverDB.delete(acceptances);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(acceptances);
  await serverDB.delete(users);
});

describe('AcceptanceModel · findBySubjects', () => {
  it('answers an empty batch without querying the table', async () => {
    await seedAcceptance('task-a');

    expect(await model.findBySubjects('task', [])).toEqual([]);
  });

  it('returns one row per requested subject, within the caller scope and one type', async () => {
    const mine = await seedAcceptance('task-a');
    const alsoMine = await seedAcceptance('task-b');
    await seedAcceptance('task-foreign', otherUserId);
    await seedAcceptance('topic-a');

    const rows = await model.findBySubjects('task', ['task-a', 'task-b', 'task-foreign']);

    expect(rows.map((row) => row.id).sort()).toEqual([mine.id, alsoMine.id].sort());
    expect(rows.every((row) => row.userId === userId)).toBe(true);
  });
});

describe('AcceptanceModel · claimRepair', () => {
  it('claims an untouched handoff and persists it on the acceptance', async () => {
    const acceptance = await seedAcceptance('task-claim');
    const request = repairRequest();

    const result = await model.claimRepair(acceptance.id, request);

    expect(result).toEqual({ claimed: true, request });
    expect((await model.findById(acceptance.id))?.metadata?.repair).toEqual(request);
  });

  it('shares one handler between concurrent submissions', async () => {
    const acceptance = await seedAcceptance('task-concurrent');
    const running = repairRequest({ state: 'running' });
    await serverDB
      .update(acceptances)
      .set({ metadata: { repair: running } })
      .where(eq(acceptances.id, acceptance.id));

    const result = await model.claimRepair(
      acceptance.id,
      repairRequest({ id: 'repair-request-2' }),
    );

    expect(result).toEqual({ claimed: false, request: running });
    expect((await model.findById(acceptance.id))?.metadata?.repair).toEqual(running);
  });

  it('retries the failed handoff itself, clearing its stale dispatch pointers', async () => {
    const acceptance = await seedAcceptance('task-failed');
    await serverDB
      .update(acceptances)
      .set({
        metadata: {
          repair: repairRequest({
            error: 'device went offline',
            operationId: 'operation-1',
            state: 'failed',
            topicId: 'topic-1',
          }),
        },
      })
      .where(eq(acceptances.id, acceptance.id));

    const result = await model.claimRepair(
      acceptance.id,
      repairRequest({ id: 'repair-request-3' }),
    );

    expect(result.claimed).toBe(true);
    expect(result.request.state).toBe('starting');
    // The retry continues the handoff that failed, so its id survives the reset.
    expect(result.request.id).toBe('repair-request-1');
    const persisted = (await model.findById(acceptance.id))?.metadata?.repair;
    expect(persisted).toMatchObject({ id: 'repair-request-1', state: 'starting' });
    // The reset drops the dead dispatch rather than leaving it to be read as current.
    expect(persisted).not.toHaveProperty('error');
    expect(persisted).not.toHaveProperty('operationId');
    expect(persisted).not.toHaveProperty('topicId');
  });

  it('refuses to claim an acceptance outside the caller scope', async () => {
    const foreign = await seedAcceptance('task-foreign-claim', otherUserId);

    await expect(model.claimRepair(foreign.id, repairRequest())).rejects.toThrow(
      'Acceptance not found',
    );
    expect(
      (await serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, foreign.id) }))
        ?.metadata ?? null,
    ).toBeNull();
  });
});

describe('AcceptanceModel · patchRepair', () => {
  it('ignores a late callback from a superseded handoff', async () => {
    const acceptance = await seedAcceptance('task-patch-stale');
    await model.claimRepair(acceptance.id, repairRequest({ id: 'repair-request-new' }));

    const patched = await model.patchRepair(acceptance.id, 'repair-request-old', {
      state: 'finished',
    });

    expect(patched).toBeUndefined();
    expect((await model.findById(acceptance.id))?.metadata?.repair).toMatchObject({
      id: 'repair-request-new',
      state: 'starting',
    });
  });

  it('merges a callback that still matches the current handoff', async () => {
    const acceptance = await seedAcceptance('task-patch');
    await model.claimRepair(acceptance.id, repairRequest({ id: 'repair-request-match' }));

    const patched = await model.patchRepair(acceptance.id, 'repair-request-match', {
      operationId: 'operation-9',
      state: 'running',
    });

    expect(patched?.metadata?.repair).toMatchObject({
      id: 'repair-request-match',
      operationId: 'operation-9',
      state: 'running',
    });
  });
});

describe('AcceptanceModel · findPolicyById', () => {
  it('reads a policy by id for the owning scope', async () => {
    const acceptance = await seedAcceptance('task-policy');

    expect((await model.findPolicyById(acceptance.id))?.id).toBe(acceptance.id);
  });

  it('treats a malformed id as “not found” instead of failing the query', async () => {
    // An autolinker can glue trailing punctuation onto a pasted id; the uuid
    // cast would raise 22P02 and turn a miss into a 500.
    expect(await model.findPolicyById('not-a-uuid.')).toBeUndefined();
  });
});

describe('AcceptanceModel · deletion', () => {
  it('deletes only the caller’s acceptance', async () => {
    const mine = await seedAcceptance('task-delete-mine');
    const foreign = await seedAcceptance('task-delete-foreign', otherUserId);

    await model.delete(foreign.id);
    expect(
      await serverDB.query.acceptances.findFirst({ where: eq(acceptances.id, foreign.id) }),
    ).toBeTruthy();

    await model.delete(mine.id);
    expect(await model.findById(mine.id)).toBeUndefined();
  });

  it('is a no-op for an empty subject batch', async () => {
    const acceptance = await seedAcceptance('task-delete-empty');

    await model.deleteBySubjects('task', []);

    expect(await serverDB.query.acceptances.findFirst({
      where: eq(acceptances.id, acceptance.id),
    })).toBeTruthy();
  });

  it('deletes the given subjects inside the caller scope only', async () => {
    const mine = await seedAcceptance('task-delete-batch');
    const untouched = await seedAcceptance('task-delete-kept');
    const foreign = await seedAcceptance('task-delete-batch', otherUserId);

    await model.deleteBySubjects('task', ['task-delete-batch']);

    const remaining = await serverDB.select().from(acceptances);
    expect(remaining.map((row) => row.id).sort()).toEqual([untouched.id, foreign.id].sort());
    expect(remaining.map((row) => row.id)).not.toContain(mine.id);
  });
});
