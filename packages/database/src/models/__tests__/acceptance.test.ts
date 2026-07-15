// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { acceptances, topics, users, verifyRuns } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AcceptanceModel } from '../acceptance';
import { VerifyRunModel } from '../verifyRun';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'acceptance-test-user';
const otherUserId = 'acceptance-test-other';
const topicId = 'acceptance-test-topic';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([{ id: topicId, userId }]);
});

afterEach(async () => {
  await serverDB.delete(verifyRuns);
  await serverDB.delete(acceptances);
  await serverDB.delete(topics);
  await serverDB.delete(users);
});

describe('AcceptanceModel', () => {
  it('ensureForSubject creates once and converges on the same row', async () => {
    const model = new AcceptanceModel(serverDB, userId);

    const first = await model.ensureForSubject('topic', topicId, {
      requirement: 'All checks green',
    });
    expect(first.status).toBe('pending');
    expect(first.requirement).toBe('All checks green');

    // Second ensure returns the SAME aggregate and never overwrites defaults.
    const second = await model.ensureForSubject('topic', topicId, {
      requirement: 'Different text',
    });
    expect(second.id).toBe(first.id);
    expect(second.requirement).toBe('All checks green');
  });

  it('scopes subject lookup per owner', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    await model.ensureForSubject('topic', topicId);

    const otherModel = new AcceptanceModel(serverDB, otherUserId);
    expect(await otherModel.findBySubject('topic', topicId)).toBeUndefined();
  });

  it('updateStatus stamps completedAt only on user-terminal statuses', async () => {
    const model = new AcceptanceModel(serverDB, userId);
    const row = await model.ensureForSubject('topic', topicId);

    await model.updateStatus(row.id, 'delivered');
    expect((await model.findById(row.id))?.completedAt).toBeNull();

    await model.updateStatus(row.id, 'accepted');
    expect((await model.findById(row.id))?.completedAt).toBeInstanceOf(Date);

    // A new round re-opening the loop clears the completion stamp.
    await model.updateStatus(row.id, 'verifying');
    expect((await model.findById(row.id))?.completedAt).toBeNull();
  });
});

describe('VerifyRunModel acceptance chain', () => {
  it('attachToAcceptance assigns sequential round indexes', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const runModel = new VerifyRunModel(serverDB, userId);
    const first = await runModel.create({ source: 'agent-testing', title: 'round 1' });
    const second = await runModel.create({ source: 'agent-testing', title: 'round 2' });

    const attached1 = await runModel.attachToAcceptance(first.id, acceptance.id);
    const attached2 = await runModel.attachToAcceptance(second.id, acceptance.id);
    expect(attached1.roundIndex).toBe(1);
    expect(attached2.roundIndex).toBe(2);

    const rounds = await runModel.listByAcceptance(acceptance.id);
    expect(rounds.map((r) => r.title)).toEqual(['round 1', 'round 2']);
  });

  it('setDecision records the user verdict with its detail', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const runModel = new VerifyRunModel(serverDB, userId);
    const run = await runModel.create({ source: 'agent-testing' });
    await runModel.attachToAcceptance(run.id, acceptance.id);

    await runModel.setDecision(run.id, 'reject', {
      comment: 'dark mode needs a screenshot',
      decidedAt: new Date().toISOString(),
      decidedBy: userId,
    });

    const found = await runModel.findById(run.id);
    expect(found?.userDecision).toBe('reject');
    expect(found?.decisionDetail?.comment).toBe('dark mode needs a screenshot');
  });

  it('rejects attaching a run that is not owned by the caller', async () => {
    const acceptanceModel = new AcceptanceModel(serverDB, userId);
    const acceptance = await acceptanceModel.ensureForSubject('topic', topicId);

    const otherRun = await new VerifyRunModel(serverDB, otherUserId).create({
      source: 'agent-testing',
    });

    await expect(
      new VerifyRunModel(serverDB, userId).attachToAcceptance(otherRun.id, acceptance.id),
    ).rejects.toThrow('not found');
  });
});
