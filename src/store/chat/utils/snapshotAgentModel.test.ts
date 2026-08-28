import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';
import { describe, expect, it, vi } from 'vitest';

import { snapshotAgentModel } from './snapshotAgentModel';

const agentMap: Record<string, any> = {};

vi.mock('@/store/agent', () => ({ getAgentStoreState: () => ({ agentMap }) }));

const seedAgent = (id: string, config: Record<string, any>) => {
  agentMap[id] = config;
  return id;
};

describe('snapshotAgentModel', () => {
  it('returns nothing without an agent', () => {
    expect(snapshotAgentModel()).toEqual({});
    expect(snapshotAgentModel(null)).toEqual({});
  });

  it('snapshots the pinned model/provider of a regular agent', () => {
    const id = seedAgent('regular', { model: 'gpt-5.5', provider: 'openai' });

    expect(snapshotAgentModel(id)).toEqual({ model: 'gpt-5.5', provider: 'openai' });
  });

  it('snapshots the platform defaults when a regular agent pinned nothing', () => {
    const id = seedAgent('regular-blank', {});

    // the effective model IS the default here, and the topic must keep it even
    // after the agent default later changes
    expect(snapshotAgentModel(id)).toEqual({ model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER });
  });

  it('snapshots the CLI default selection for a heterogeneous agent', () => {
    const id = seedAgent('hetero', {
      agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
    });

    expect(snapshotAgentModel(id)).toEqual({ model: 'default', provider: 'claude-code' });
  });

  it('ignores a stale agent model when the agent is heterogeneous', () => {
    const id = seedAgent('hetero-with-model', {
      agencyConfig: { heterogeneousProvider: { type: 'codex' } },
      model: DEFAULT_MODEL,
      provider: DEFAULT_PROVIDER,
    });

    expect(snapshotAgentModel(id)).toEqual({ model: 'default', provider: 'codex' });
  });

  it('snapshots the persisted heterogeneous selector instead of legacy native args', () => {
    const id = seedAgent('cursor-with-model-arg', {
      agencyConfig: {
        heterogeneousProvider: {
          args: ['--model', 'composer-2'],
          model: 'stale-model',
          type: 'cursor',
        },
      },
    });

    expect(snapshotAgentModel(id)).toEqual({ model: 'stale-model', provider: 'cursor' });
  });

  it('snapshots a heterogeneous API binding', () => {
    const id = seedAgent('cursor-api', {
      agencyConfig: {
        heterogeneousProvider: {
          apiConfig: { model: 'claude-sonnet-4-6', providerId: 'anthropic' },
          authMode: 'api',
          type: 'cursor',
        },
      },
    });

    expect(snapshotAgentModel(id)).toEqual({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });
  });

  it('keeps a server-default API model Agent-scoped', () => {
    const id = seedAgent('claude-server-default', {
      agencyConfig: {
        heterogeneousProvider: {
          apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' },
          authMode: 'api',
          type: 'claude-code',
        },
      },
    });

    expect(snapshotAgentModel(id)).toEqual({ provider: 'claude-code' });
  });

  it('pins nothing when a heterogeneous config carries no type', () => {
    const id = seedAgent('hetero-untyped', {
      agencyConfig: { heterogeneousProvider: { command: 'claude' } },
      provider: DEFAULT_PROVIDER,
    });

    expect(snapshotAgentModel(id)).toEqual({});
  });
});
