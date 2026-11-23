// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';

import type * as Procedures from './procedures';
import { runRouter } from './runs';

const mocks = vi.hoisted(() => ({ createRun: vi.fn() }));

vi.mock('./procedures', async (importOriginal) => {
  const actual = await importOriginal<typeof Procedures>();
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({ ctx: { runService: { createRun: mocks.createRun } } as any }),
  );
  return { ...actual, agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

const caller = createCallerFactory(runRouter)({} as any);

describe('createSubjectRuns', () => {
  beforeEach(() => {
    mocks.createRun.mockReset().mockImplementation(async (input) => ({ id: input.name }));
  });

  it('creates one run per distinct model, each swapping the agent model via config.model', async () => {
    const runs = await caller.createSubjectRuns({
      config: { k: 2 },
      datasetId: 'ds-1',
      name: 'Bad case',
      subjects: [
        { model: 'gpt-6-luna', provider: 'openai' },
        { model: 'claude-sonnet-5-5', provider: 'anthropic' },
        { model: 'gpt-6-luna', provider: 'openai' },
      ],
      targetAgentId: 'agt-1',
    });

    expect(runs).toHaveLength(2);
    expect(mocks.createRun).toHaveBeenCalledWith({
      config: { k: 2, model: 'gpt-6-luna', provider: 'openai' },
      datasetId: 'ds-1',
      name: 'Bad case · gpt-6-luna',
      targetAgentId: 'agt-1',
    });
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { k: 2, model: 'claude-sonnet-5-5', provider: 'anthropic' },
        name: 'Bad case · claude-sonnet-5-5',
      }),
    );
  });
});
