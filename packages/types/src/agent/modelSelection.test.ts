import { describe, expect, it } from 'vitest';

import { resolveAgentModelConfig } from './modelSelection';

const shared = {
  model: 'shared-model',
  provider: 'shared-provider',
};

describe('resolveAgentModelConfig', () => {
  it('treats a missing policy as fixed for existing workspace agents', () => {
    expect(
      resolveAgentModelConfig(shared, {
        model: 'member-model',
        provider: 'member-provider',
      }),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('ignores a retained member override while the policy is fixed', () => {
    expect(
      resolveAgentModelConfig(
        { ...shared, agencyConfig: { modelSelectionPolicy: 'fixed' } },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('uses the member override when the author allows member selection', () => {
    expect(
      resolveAgentModelConfig(
        { ...shared, agencyConfig: { modelSelectionPolicy: 'member' } },
        { model: 'member-model', provider: 'member-provider' },
      ),
    ).toEqual({ model: 'member-model', provider: 'member-provider' });
  });

  it('keeps the shared model when member selection is enabled but no choice was saved', () => {
    expect(
      resolveAgentModelConfig({
        ...shared,
        agencyConfig: { modelSelectionPolicy: 'member' },
      }),
    ).toEqual({ model: 'shared-model', provider: 'shared-provider' });
  });

  it('applies explicit per-run overrides after the member choice', () => {
    expect(
      resolveAgentModelConfig(
        { ...shared, agencyConfig: { modelSelectionPolicy: 'member' } },
        { model: 'member-model', provider: 'member-provider' },
        { model: 'run-model' },
      ),
    ).toEqual({ model: 'run-model', provider: 'member-provider' });
  });
});
