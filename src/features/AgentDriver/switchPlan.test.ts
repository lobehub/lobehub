import { describe, expect, it } from 'vitest';

import { planDriverRollback, planDriverSwitch } from './switchPlan';

const defaults = { model: 'gpt-5.5', provider: 'openai' };

describe('planDriverSwitch', () => {
  it('moves a LobeHub agent onto a heterogeneous driver in one write', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: false,
      defaults,
      target: { command: 'claude', kind: 'hetero', type: 'claude-code' },
    });

    expect(plan).toEqual([
      {
        agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
        provider: 'claude-code',
      },
    ]);
  });

  it('clears the old runtime before writing the new one so no credentials carry over', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: true,
      defaults,
      target: { command: 'codex', kind: 'hetero', type: 'codex' },
    });

    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ agencyConfig: { heterogeneousProvider: null } });
    expect(plan[1]).toMatchObject({ provider: 'codex' });
  });

  it('hands the provider and model back to the default chat model when leaving a runtime', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: true,
      defaults,
      target: { kind: 'harness' },
    });

    expect(plan).toEqual([
      { agencyConfig: { heterogeneousProvider: null }, model: 'gpt-5.5', provider: 'openai' },
    ]);
  });
});

describe('planDriverRollback', () => {
  it('writes the previous provider block and its stamp back', () => {
    const previous = { command: 'claude', env: { A: '1' }, type: 'claude-code' };

    expect(
      planDriverRollback({ heterogeneousProvider: previous, provider: 'claude-code' }),
    ).toEqual({
      agencyConfig: { heterogeneousProvider: previous },
      provider: 'claude-code',
    });
  });
});
