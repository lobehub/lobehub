import { describe, expect, it, vi } from 'vitest';

import { startComposerRun } from './composerRun';

const resolveOwnableRun = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/task/topicRun', () => ({
  TopicRunService: vi.fn().mockImplementation(function () {
    return { resolveOwnableRun };
  }),
}));
vi.mock('@/server/services/task/runHooks', () => ({ createTaskRunHooks: vi.fn() }));

const run = (supersedeLiveRun?: boolean, replacesOperationId?: string) => {
  const execAgent = vi.fn().mockResolvedValue({ operationId: 'op-2' });
  return startComposerRun(
    {
      aiAgentService: {
        execAgent,
        interruptTask: vi.fn(),
        isOperationInterrupted: vi.fn().mockResolvedValue(true),
      } as any,
      db: {} as any,
      supersedeLiveRun,
      userId: 'user-1',
    },
    { agentId: 'agt-1', appContext: { topicId: 'tpc-1' }, prompt: 'hi', replacesOperationId },
  ).then(() => execAgent.mock.calls[0][0]);
};

describe('startComposerRun', () => {
  it('starts like a person at the composer by default, taking the topic over', async () => {
    await expect(run()).resolves.toMatchObject({ interactiveStart: true });
  });

  it('waits on the topic instead of interrupting its run when told not to supersede', async () => {
    await expect(run(false)).resolves.toMatchObject({ interactiveStart: false });
  });

  it('tells the Task side which run the send replaces, so it can take the run over', async () => {
    // A follow-up within seconds of the last reply supersedes a run that is
    // still `running`; without this the Task never hands the run over.
    resolveOwnableRun.mockClear().mockResolvedValue(undefined);

    await run(undefined, 'op-1');
    expect(resolveOwnableRun).toHaveBeenCalledWith('tpc-1', {
      isStopRequested: expect.any(Function),
      replacesOperationId: 'op-1',
      supersedeLiveRun: true,
      threadId: undefined,
    });
    // The interrupt state comes from the runtime the send runs on.
    const [, send] = resolveOwnableRun.mock.calls[0];
    await expect(send.isStopRequested('op-1')).resolves.toBe(true);

    await run(false);
    expect(resolveOwnableRun).toHaveBeenLastCalledWith('tpc-1', {
      isStopRequested: expect.any(Function),
      replacesOperationId: undefined,
      supersedeLiveRun: false,
      threadId: undefined,
    });
  });
});
