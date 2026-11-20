// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-runner-user';
const otherUserId = 'agent-operation-runner-other-user';

/** Freeze a run's lease, as a run whose runner stopped reporting would. */
const freezeLease = (operationId: string) =>
  serverDB
    .update(agentOperations)
    .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
    .where(eq(agentOperations.id, operationId));

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('AgentOperationModel.settleDisconnectedRunner', () => {
  it('retires a run whose runner is gone as runner_disconnected, behind the lease CAS', async () => {
    const model = new AgentOperationModel(serverDB, userId);
    const operationId = 'op-runner-gone';
    await model.recordStart({ operationId });

    // Still reporting: a fresh lease wins.
    expect(await model.settleDisconnectedRunner(operationId, new Date(Date.now() - 60_000))).toBe(
      false,
    );
    expect((await model.findById(operationId))?.status).toBe('running');

    await freezeLease(operationId);
    expect(await model.settleDisconnectedRunner(operationId, new Date(Date.now() - 60_000))).toBe(
      true,
    );
    expect(await model.findById(operationId)).toMatchObject({
      completionReason: 'runner_disconnected',
      status: 'abandoned',
    });
  });

  it('keeps the reason through the lifecycle write, and refuses a late completion', async () => {
    const model = new AgentOperationModel(serverDB, userId);
    const operationId = 'op-runner-gone-lifecycle';
    await model.recordStart({ operationId });
    await freezeLease(operationId);
    await model.settleDisconnectedRunner(operationId, new Date(Date.now() - 60_000));

    // `persistCompletion` writes onto the claimed row without a reason.
    expect(await model.recordCompletion(operationId, { status: 'abandoned', stepCount: 2 })).toBe(
      true,
    );
    expect(await model.recordCompletion(operationId, { status: 'done' })).toBe(false);
    expect(await model.findById(operationId)).toMatchObject({
      completionReason: 'runner_disconnected',
      status: 'abandoned',
      stepCount: 2,
    });
  });

  it('lets a forced stop claim without a lease bound, only while the run is live', async () => {
    const model = new AgentOperationModel(serverDB, userId);
    const operationId = 'op-runner-gone-forced';
    await model.recordStart({ operationId });

    expect(await model.settleDisconnectedRunner(operationId)).toBe(true);
    expect(await model.findById(operationId)).toMatchObject({
      completionReason: 'runner_disconnected',
      status: 'abandoned',
    });
    // Already terminal: nothing left to claim.
    expect(await model.settleDisconnectedRunner(operationId)).toBe(false);
  });

  it('does not let another user retire the run', async () => {
    const owner = new AgentOperationModel(serverDB, userId);
    const operationId = 'op-runner-gone-foreign';
    await owner.recordStart({ operationId });

    expect(
      await new AgentOperationModel(serverDB, otherUserId).settleDisconnectedRunner(operationId),
    ).toBe(false);
    expect((await owner.findById(operationId))?.status).toBe('running');
  });

  it('still settles stale runs as lease_expired through settleStaleRunning', async () => {
    const model = new AgentOperationModel(serverDB, userId);
    const operationId = 'op-lease-still-expired';
    await model.recordStart({ operationId });
    await freezeLease(operationId);

    expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(true);
    expect(await model.findById(operationId)).toMatchObject({
      completionReason: 'lease_expired',
      status: 'abandoned',
    });
  });
});
