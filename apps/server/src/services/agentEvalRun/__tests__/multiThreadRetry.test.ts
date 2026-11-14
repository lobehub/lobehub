import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalRunTopics, threads } from '@/database/schemas';
import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { createEvalRunDeps } from '../deps';
import { executeMultiThreadTrajectory } from '../thread';
import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerRunThreadTrajectory: vi.fn() },
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(AgentEvalRunWorkflow.triggerRunThreadTrajectory).mockReset();
  await cleanupDB();
});

async function setup(k = 2) {
  const chain = await setupEvalChain({ totalCases: 1 });
  const deps = createEvalRunDeps(serverDB, userId);
  await deps.runModel.update(chain.run.id, { status: 'running' });
  await deps.runTopicModel.updateByRunAndTopic(chain.run.id, chain.topic.id, { status: 'pending' });
  const params = {
    k,
    run: chain.run,
    runId: chain.run.id,
    testCaseId: chain.testCase.id,
  };
  const execute = () => executeMultiThreadTrajectory(deps, params);
  const attempts = () => serverDB.select().from(threads).where(eq(threads.topicId, chain.topic.id));
  return { ...chain, attempts, deps, execute };
}

describe('pass@k workflow dispatch recovery', () => {
  it('retries the missing dispatch using its original attempt without repeating a claimed sibling', async () => {
    const chain = await setup();
    const trigger = vi.mocked(AgentEvalRunWorkflow.triggerRunThreadTrajectory);
    const failure = new Error('dispatch unavailable');
    let claimedThreadId: string | undefined;
    let missingThreadId: string | undefined;
    trigger.mockImplementation(async (payload) => {
      if (!claimedThreadId) {
        claimedThreadId = payload.threadId;
        expect(
          await chain.deps.executionRepo.claimExecution({
            ...payload,
            executionId: 'claimed-sibling',
            expectedExecutionId: payload.executionId,
          }),
        ).toBeDefined();
      } else {
        missingThreadId = payload.threadId;
        throw failure;
      }
      return undefined as any;
    });
    await expect(chain.execute()).rejects.toBe(failure);
    const original = await chain.attempts();
    expect(original).toHaveLength(2);
    trigger.mockReset().mockResolvedValue(undefined as any);

    const retried = await chain.execute();

    expect(retried?.threadIds.toSorted()).toEqual(original.map((row) => row.id).toSorted());
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ threadId: missingThreadId }));
    expect((await chain.attempts()).map((row) => row.id).toSorted()).toEqual(
      original.map((row) => row.id).toSorted(),
    );
  });

  it('rolls back allocated attempts if binding them to the parent fails, then retries cleanly', async () => {
    const chain = await setup();
    const originalTransaction = serverDB.transaction.bind(serverDB);
    const failure = new Error('binding unavailable');
    vi.spyOn(serverDB, 'transaction').mockImplementationOnce(((work: any) =>
      originalTransaction((tx) =>
        work(
          new Proxy(tx, {
            get(target, property) {
              if (property === 'update')
                return (table: unknown) => {
                  if (table === agentEvalRunTopics) throw failure;
                  return target.update(table as any);
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        ),
      )) as any);

    await expect(chain.execute()).rejects.toBe(failure);
    expect(await chain.attempts()).toEqual([]);
    expect(
      await chain.deps.runTopicModel.findByRunAndTestCase(chain.run.id, chain.testCase.id),
    ).toMatchObject({ status: 'pending', evalResult: null });

    await chain.execute();
    expect(await chain.attempts()).toHaveLength(2);
    expect(AgentEvalRunWorkflow.triggerRunThreadTrajectory).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch or recreate attempts when Stop wins before the retry', async () => {
    const chain = await setup();
    const trigger = vi.mocked(AgentEvalRunWorkflow.triggerRunThreadTrajectory);
    trigger.mockRejectedValue(new Error('dispatch unavailable'));
    await expect(chain.execute()).rejects.toThrow('dispatch unavailable');
    const originalIds = (await chain.attempts()).map((row) => row.id).toSorted();
    await chain.deps.executionRepo.batchMarkAborted(chain.run.id);
    trigger.mockClear();

    expect(await chain.execute()).toBeUndefined();
    expect(trigger).not.toHaveBeenCalled();
    expect((await chain.attempts()).map((row) => row.id).toSorted()).toEqual(originalIds);
  });

  it('shares one persisted set across concurrent retries and permits only one execution claim', async () => {
    const chain = await setup();
    const trigger = vi.mocked(AgentEvalRunWorkflow.triggerRunThreadTrajectory);
    trigger.mockResolvedValue(undefined as any);
    const results = await Promise.all([chain.execute(), chain.execute()]);
    expect(results[0]?.threadIds.toSorted()).toEqual(results[1]?.threadIds.toSorted());
    expect(await chain.attempts()).toHaveLength(2);
    const payload = trigger.mock.calls[0][0];
    const claims = await Promise.all(
      ['first', 'duplicate'].map((executionId) =>
        chain.deps.executionRepo.claimExecution({
          ...payload,
          executionId,
          expectedExecutionId: payload.executionId,
        }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
