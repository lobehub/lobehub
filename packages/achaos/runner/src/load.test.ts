import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadChaosExperiments } from './load';

describe('loadChaosExperiments', () => {
  it('validates and loads the first-phase YAML fixtures', async () => {
    const fixtures = await loadChaosExperiments(
      path.resolve(import.meta.dirname, '../../../../.agents/chaos/fixtures'),
    );
    expect(fixtures.map(({ experiment }) => experiment.id)).toEqual([
      'tool-failure',
      'operation-reclaim',
      'duplicate-completion',
    ]);
  });
});
