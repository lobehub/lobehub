import { describe, expect, it } from 'vitest';

import { chaosExperimentSchema } from './schema';

describe('chaosExperimentSchema', () => {
  it('rejects unsafe incomplete experiment data', () => {
    expect(() => chaosExperimentSchema.parse({ id: 'bad experiment' })).toThrow();
  });

  it('accepts a replayable experiment', () => {
    const result = chaosExperimentSchema.parse({
      description: 'Inject a tool timeout',
      effect: { errorType: 'Timeout', type: 'throw' },
      id: 'tool-timeout',
      layer: 'L1-model-runtime',
      oracles: [{ name: 'fallback-used' }],
      safety: { allowedEnvironments: ['test'] },
      seed: 'stable-seed',
      target: { adapter: 'runtime', selector: { apiName: 'search' } },
      timeoutMs: 1000,
      trigger: { when: 'before' },
    });
    expect(result.cleanup).toBe('always');
  });

  it('rejects misspelled safety-policy keys', () => {
    expect(() =>
      chaosExperimentSchema.parse({
        description: 'Unsafe typo',
        effect: { type: 'drop' },
        id: 'unsafe-typo',
        layer: 'L2-agent-runtime',
        oracles: [{ name: 'healthy' }],
        safety: { allowedEnvironments: ['test'], maxInjection: 1 },
        seed: 'seed',
        target: { adapter: 'runtime', selector: {} },
        timeoutMs: 1000,
        trigger: { when: 'immediate' },
      }),
    ).toThrow(/maxInjection/);
  });
});
