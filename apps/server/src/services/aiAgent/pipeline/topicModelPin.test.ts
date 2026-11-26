import { describe, expect, it, vi } from 'vitest';

import { pickTopicModelPin, resolveRunStartingModel } from './topicModelPin';

const agentConfig = { model: 'regular-model', provider: 'regular-provider' };
const run = (topic: unknown, extra: Record<string, unknown> = {}) => {
  const findById = vi.fn().mockResolvedValue(topic);
  return {
    findById,
    result: resolveRunStartingModel({ topicModel: { findById } as any }, {
      agentConfig,
      resolvedAgentId: 'agent-1',
      topicId: 'topic-1',
      ...extra,
    } as any),
  };
};

describe('resolveRunStartingModel', () => {
  it('starts on the model the reused topic pinned, not the agent default', async () => {
    const topic = {
      agentId: 'agent-1',
      id: 'topic-1',
      model: 'pinned',
      provider: 'pinned-provider',
    };
    const { result } = run(topic);

    await expect(result).resolves.toEqual({ model: 'pinned', provider: 'pinned-provider', topic });
  });

  it('keeps the agent default for a topic without a pin and for a new topic', async () => {
    await expect(run({ agentId: 'agent-1', id: 'topic-1' }).result).resolves.toMatchObject({
      model: 'regular-model',
      provider: 'regular-provider',
    });

    const { findById, result } = run(undefined, { topicId: undefined });
    await expect(result).resolves.toEqual({ model: 'regular-model', provider: 'regular-provider' });
    expect(findById).not.toHaveBeenCalled();
  });

  it('lets an explicit per-run model beat the pin', async () => {
    const { result } = run(
      { agentId: 'agent-1', id: 'topic-1', model: 'pinned', provider: 'pinned-provider' },
      { modelOverride: 'override', providerOverride: 'override-provider' },
    );

    await expect(result).resolves.toMatchObject({
      model: 'override',
      provider: 'override-provider',
    });
  });

  it('ignores the pin of another agent’s topic and leaves external agents on their config', async () => {
    const foreign = { agentId: 'caller', id: 'topic-1', model: 'pinned', provider: 'p' };
    await expect(run(foreign).result).resolves.toMatchObject({ model: 'regular-model' });

    const pinned = { agentId: 'agent-1', id: 'topic-1', model: 'pinned', provider: 'p' };
    await expect(
      run(pinned, { agentConfig: { ...agentConfig, agencyConfig: { heterogeneousProvider: {} } } })
        .result,
    ).resolves.toMatchObject({ model: 'regular-model' });
  });
});

describe('pickTopicModelPin', () => {
  it('keeps the pin of a legacy topic without an owner', () => {
    expect(pickTopicModelPin({ model: 'm' } as any, 'agent-1').pinnedModel).toBe('m');
  });
});
