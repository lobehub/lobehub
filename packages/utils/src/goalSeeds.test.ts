import { describe, expect, it } from 'vitest';

import { goalSeedDependencyProblem } from './goalSeeds';

describe('goalSeedDependencyProblem', () => {
  it('accepts seeds whose dependencies form a DAG', () => {
    expect(
      goalSeedDependencyProblem([
        'Signal',
        { dependsOn: ['Signal'], title: 'Policy' },
        { dependsOn: ['Signal', 'Policy'], title: 'Context' },
      ]),
    ).toBeUndefined();
  });

  it('allows duplicate titles when nothing depends on anything', () => {
    expect(goalSeedDependencyProblem(['A', 'A'])).toBeUndefined();
  });

  it('names a dependency that is not a seed', () => {
    expect(goalSeedDependencyProblem([{ dependsOn: ['Signl'], title: 'Policy' }, 'Signal'])).toBe(
      '"Policy" depends on "Signl", which is not a seed task',
    );
  });

  it('refuses duplicate titles once dependsOn has to name them', () => {
    expect(goalSeedDependencyProblem(['A', 'A', { dependsOn: ['A'], title: 'B' }])).toBe(
      '"A" appears twice, so dependsOn cannot name it',
    );
  });

  it('refuses a task depending on itself', () => {
    expect(goalSeedDependencyProblem([{ dependsOn: ['A'], title: 'A' }])).toBe(
      '"A" cannot depend on itself',
    );
  });

  it('refuses a cycle and spells it out', () => {
    expect(
      goalSeedDependencyProblem([
        { dependsOn: ['B'], title: 'A' },
        { dependsOn: ['C'], title: 'B' },
        { dependsOn: ['A'], title: 'C' },
        'D',
      ]),
    ).toBe('dependsOn forms a cycle: "A" → "B" → "C" → "A"');
  });
});
