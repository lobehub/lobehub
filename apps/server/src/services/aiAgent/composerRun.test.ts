import { describe, expect, it, vi } from 'vitest';

import { startComposerRun } from './composerRun';

vi.mock('@/server/services/task/topicRun', () => ({
  TopicRunService: vi.fn().mockImplementation(function () {
    return { resolveOwnableRun: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock('@/server/services/task/runHooks', () => ({ createTaskRunHooks: vi.fn() }));

const run = (supersedeLiveRun?: boolean) => {
  const execAgent = vi.fn().mockResolvedValue({ operationId: 'op-2' });
  return startComposerRun(
    {
      aiAgentService: { execAgent, interruptTask: vi.fn() } as any,
      db: {} as any,
      supersedeLiveRun,
      userId: 'user-1',
    },
    { agentId: 'agt-1', appContext: { topicId: 'tpc-1' }, prompt: 'hi' },
  ).then(() => execAgent.mock.calls[0][0]);
};

describe('startComposerRun', () => {
  it('starts like a person at the composer by default, taking the topic over', async () => {
    await expect(run()).resolves.toMatchObject({ interactiveStart: true });
  });

  it('waits on the topic instead of interrupting its run when told not to supersede', async () => {
    await expect(run(false)).resolves.toMatchObject({ interactiveStart: false });
  });
});
