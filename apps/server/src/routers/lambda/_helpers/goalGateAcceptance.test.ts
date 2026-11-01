// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertNotHoldingRelease, withGoalGateAnswer } from './goalGateAcceptance';

const findByNode = vi.hoisted(() => vi.fn());
const answerReleaseGate = vi.hoisted(() => vi.fn());
const scheduleGoalAdvance = vi.hoisted(() => vi.fn());
const listByAcceptance = vi.hoisted(() => vi.fn());
const advanceGoal = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/goal', () => ({
  GoalModel: class {
    findByNode = findByNode;
  },
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: class {
    listByAcceptance = listByAcceptance;
  },
}));
vi.mock('@/server/services/goal', () => ({
  GoalService: class {
    answerReleaseGate = answerReleaseGate;
  },
}));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance }));
vi.mock('@/server/services/goal/advanceGoal', () => ({ advanceGoal }));

const db = {} as never;
const gate = (id = 'acc_gate') =>
  ({
    id,
    subjectId: 'node_release',
    subjectType: 'goal_gate',
    userId: 'me',
    workspaceId: null,
  }) as never;
const heldOn = (acceptanceId: string, phase: string) => ({
  config: { rolloutState: { phase, releaseGateAcceptanceId: acceptanceId } },
});

beforeEach(() => {
  findByNode.mockReset();
  answerReleaseGate.mockReset();
  scheduleGoalAdvance.mockReset();
  listByAcceptance.mockReset();
  advanceGoal.mockReset();
});

describe('assertNotHoldingRelease', () => {
  it('refuses to settle a report a batch is still held on', async () => {
    findByNode.mockResolvedValue(heldOn('acc_gate', 'release_review'));
    await expect(assertNotHoldingRelease(db, gate())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // Sent back and being rewritten: the rewrite comes back to the same report.
    findByNode.mockResolvedValue(heldOn('acc_gate', 'plan_revision'));
    await expect(assertNotHoldingRelease(db, gate())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('lets a decided gate report, or any other delivery, go', async () => {
    findByNode.mockResolvedValue(heldOn('acc_gate', 'mass'));
    await expect(assertNotHoldingRelease(db, gate())).resolves.toBeUndefined();

    findByNode.mockResolvedValue(heldOn('acc_newer', 'release_review'));
    await expect(assertNotHoldingRelease(db, gate())).resolves.toBeUndefined();

    await expect(
      assertNotHoldingRelease(db, { subjectType: 'task' } as never),
    ).resolves.toBeUndefined();
    expect(findByNode).toHaveBeenCalledTimes(2);
  });
});

describe('withGoalGateAnswer', () => {
  const service = (decidable: boolean) =>
    ({
      acceptanceModel: {
        findById: vi.fn(async () => ({ status: decidable ? 'delivered' : 'closed' })),
      },
    }) as never;

  it('leaves the goal alone when the report cannot take the decision', async () => {
    const write = vi.fn();

    await expect(
      withGoalGateAnswer(db, service(false), gate(), 'release', {}, write),
    ).rejects.toThrow('closed');
    expect(answerReleaseGate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('advances the goal only after the report recorded the decision', async () => {
    answerReleaseGate.mockResolvedValue('goal_1');
    const write = vi.fn(async () => {
      expect(scheduleGoalAdvance).not.toHaveBeenCalled();
      return 'written';
    });

    await expect(withGoalGateAnswer(db, service(true), gate(), 'release', {}, write)).resolves.toBe(
      'written',
    );
    expect(answerReleaseGate).toHaveBeenCalledWith('node_release', 'release', undefined);
    expect(scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal_1', trigger: 'decide' }),
    );
    expect(advanceGoal).not.toHaveBeenCalled();
  });

  // The owner's panel opens on the main Agent's hand-off as the request
  // returns, so a send-back hands it over in the request, not on the queue.
  it('hands a sent-back plan to the main Agent before answering', async () => {
    answerReleaseGate.mockResolvedValue('goal_1');
    advanceGoal.mockResolvedValue({ goalId: 'goal_1', ticks: 2 });
    const write = vi.fn(async () => {
      expect(advanceGoal).not.toHaveBeenCalled();
      return 'written';
    });

    await expect(
      withGoalGateAnswer(db, service(true), gate(), 'revise', { comment: '补上播种' }, write),
    ).resolves.toBe('written');
    expect(answerReleaseGate).toHaveBeenCalledWith('node_release', 'revise', '补上播种');
    expect(advanceGoal).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal_1', trigger: 'decide' }),
    );
    expect(scheduleGoalAdvance).not.toHaveBeenCalled();
  });

  it('queues the hand-off when the inline advance fails', async () => {
    answerReleaseGate.mockResolvedValue('goal_1');
    advanceGoal.mockRejectedValue(new Error('db busy'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      withGoalGateAnswer(db, service(true), gate(), 'revise', { comment: '补上播种' }, vi.fn()),
    ).resolves.toBeUndefined();
    expect(scheduleGoalAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal_1', trigger: 'decide' }),
    );
  });

  it('refuses a decision made on a round the rewritten plan replaced', async () => {
    answerReleaseGate.mockResolvedValue('goal_1');
    listByAcceptance.mockResolvedValue([{ id: 'round_1' }, { id: 'round_2' }]);
    const write = vi.fn(async () => 'written');

    // A tab still showing the first plan approves after the rewrite arrived.
    await expect(
      withGoalGateAnswer(db, service(true), gate(), 'release', { roundId: 'round_1' }, write),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(answerReleaseGate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    await expect(
      withGoalGateAnswer(db, service(true), gate(), 'release', { roundId: 'round_2' }, write),
    ).resolves.toBe('written');
    expect(answerReleaseGate).toHaveBeenCalledWith('node_release', 'release', undefined);
  });

  it('does not advance a goal when the report write failed', async () => {
    answerReleaseGate.mockResolvedValue('goal_1');

    await expect(
      withGoalGateAnswer(db, service(true), gate(), 'release', {}, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(scheduleGoalAdvance).not.toHaveBeenCalled();
  });
});
